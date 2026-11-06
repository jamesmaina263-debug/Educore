"use server";

import { createClient } from "@/lib/supabase/server";
import { tagSentryRequestContext } from "@/lib/observability/sentry-context";
import { classifyTrend, type TrendResult } from "@/lib/academics/growth-trend";
import { configFor, levelPoints } from "@/lib/academics/performance-analytics";

// ---------------------------------------------------------------------------
// Growth analysis (Performance Appraisal Engine directive, Phase 12 / roadmap
// Step 8). Reuses existing data end-to-end -- no new tables:
//   - marks (numeric-model subject scores) -> percentage per exam
//   - competency_marks (CBC sub-strand ratings) -> band points/level_order per exam
//   - competency_indicator_ratings (Step 5/6 core-competency/value/PCI 3-2-1) -> per term
// Chronological ordering comes from academic_years.start_date, then
// terms.term_number, since a student's class_id (and therefore which
// `classes` row they're in) changes every academic year -- there is no
// stable per-student class to join through, so everything below is fetched
// by student_id alone and ordered via the exam/term's own dates.
//
// All classification logic itself lives in growth-trend.ts and is unit
// tested there; this file only fetches and shapes data.
// ---------------------------------------------------------------------------

interface ChronoKey {
  yearStart: string;
  termNumber: number;
  examCreatedAt: string;
}

function chronoCompare(a: ChronoKey, b: ChronoKey) {
  return (
    a.yearStart.localeCompare(b.yearStart) ||
    a.termNumber - b.termNumber ||
    a.examCreatedAt.localeCompare(b.examCreatedAt)
  );
}

export interface SubjectGrowth {
  subjectId: string;
  subjectName: string;
  trend: TrendResult;
}

export interface IndicatorGrowth {
  indicatorId: string;
  indicatorName: string;
  indicatorType: string;
  trend: TrendResult;
}

export interface SubStrandGrowth {
  subStrandId: string;
  subStrandName: string;
  subjectName: string;
  trend: TrendResult;
}

export interface StudentGrowthSummary {
  subjects: SubjectGrowth[];
  coreCompetencies: IndicatorGrowth[];
  subStrandCompetencies: SubStrandGrowth[];
}

export async function getStudentGrowth(studentId: string): Promise<StudentGrowthSummary | { error: string }> {
  const supabase = await createClient();
  await tagSentryRequestContext(supabase);

  // ---- 1. Subject percentage trend (numeric-model marks only) ----
  const { data: markRows, error: markError } = await supabase
    .from("marks")
    .select(
      "subject_id, exam_id, class_id, raw_score, subjects(name), exams(name, created_at, terms(term_number, academic_years(start_date)))",
    )
    .eq("student_id", studentId)
    .not("raw_score", "is", null);
  if (markError) return { error: markError.message };

  const examIdsForMarks = [...new Set((markRows ?? []).map((m) => m.exam_id))];
  const { data: examSubjectRows } = examIdsForMarks.length
    ? await supabase.from("exam_subjects").select("exam_id, class_id, subject_id, max_score").in("exam_id", examIdsForMarks)
    : { data: [] as { exam_id: string; class_id: string; subject_id: string; max_score: number }[] };
  const maxScoreByKey = new Map<string, number>();
  for (const es of examSubjectRows ?? []) {
    maxScoreByKey.set(`${es.exam_id}|${es.class_id}|${es.subject_id}`, es.max_score as number);
  }

  const subjectSeries = new Map<string, { name: string; points: { key: ChronoKey; label: string; value: number }[] }>();
  for (const m of markRows ?? []) {
    const subject = m.subjects as unknown as { name: string } | null;
    const exam = m.exams as unknown as {
      name: string;
      created_at: string;
      terms: { term_number: number; academic_years: { start_date: string } | null } | null;
    } | null;
    if (!subject || !exam?.terms?.academic_years || m.raw_score === null) continue;
    const maxScore = maxScoreByKey.get(`${m.exam_id}|${m.class_id}|${m.subject_id}`);
    if (!maxScore) continue;
    const percentage = (m.raw_score / maxScore) * 100;
    const entry = subjectSeries.get(m.subject_id) ?? { name: subject.name, points: [] };
    entry.points.push({
      key: { yearStart: exam.terms.academic_years.start_date, termNumber: exam.terms.term_number, examCreatedAt: exam.created_at },
      label: exam.name,
      value: Math.round(percentage * 10) / 10,
    });
    subjectSeries.set(m.subject_id, entry);
  }

  const subjects: SubjectGrowth[] = [...subjectSeries.entries()].map(([subjectId, { name, points }]) => {
    const sorted = points.sort((a, b) => chronoCompare(a.key, b.key));
    return {
      subjectId,
      subjectName: name,
      trend: classifyTrend(sorted.map(({ label, value }) => ({ label, value }))),
    };
  });

  // Number of levels per grading scale. A band's own `points` is used when the scale has them; otherwise
  // the level is scored best = number of levels ... worst = 1. (Using level_order directly would read
  // A=1 ... D=4 as a RISE when a learner slides from A to D.)
  const { data: levelRows } = await supabase.from("grading_scale_bands").select("grading_scale_id, level_order");
  const levelCounts = new Map<string, number>();
  for (const b of (levelRows ?? []) as { grading_scale_id: string; level_order: number }[]) {
    levelCounts.set(b.grading_scale_id, Math.max(levelCounts.get(b.grading_scale_id) ?? 0, b.level_order));
  }
  const bandValue = (band: { points: number | null; level_order: number; grading_scale_id: string }): number | null => {
    const count = levelCounts.get(band.grading_scale_id);
    return count === undefined ? (band.points ?? null) : levelPoints(band.points, band.level_order, count);
  };

  // These two series are level points (1 to 3 or 4), where the default 5-point stable band could never be
  // exceeded, so every trend would read "stable". Use the level scale's own band (a quarter of a level).
  const LEVEL_STABLE = configFor("level").stable;

  // ---- 2. Core-competency / value / PCI trend (per term) ----
  const { data: indicatorRows, error: indicatorError } = await supabase
    .from("competency_indicator_ratings")
    .select(
      "indicator_id, term_id, competency_indicators(name, type), grading_scale_bands(points, level_order, grading_scale_id), terms(term_number, academic_years(start_date), name)",
    )
    .eq("student_id", studentId);
  if (indicatorError) return { error: indicatorError.message };

  const indicatorSeries = new Map<
    string,
    { name: string; type: string; points: { key: ChronoKey; label: string; value: number }[] }
  >();
  for (const r of indicatorRows ?? []) {
    const indicator = r.competency_indicators as unknown as { name: string; type: string } | null;
    const band = r.grading_scale_bands as unknown as { points: number | null; level_order: number; grading_scale_id: string } | null;
    const term = r.terms as unknown as { term_number: number; name: string; academic_years: { start_date: string } | null } | null;
    const value = band ? bandValue(band) : null;
    if (!indicator || !band || value === null || !term?.academic_years) continue;
    const entry = indicatorSeries.get(r.indicator_id) ?? { name: indicator.name, type: indicator.type, points: [] };
    entry.points.push({
      key: { yearStart: term.academic_years.start_date, termNumber: term.term_number, examCreatedAt: "" },
      label: term.name,
      value,
    });
    indicatorSeries.set(r.indicator_id, entry);
  }

  const coreCompetencies: IndicatorGrowth[] = [...indicatorSeries.entries()].map(([indicatorId, { name, type, points }]) => {
    const sorted = points.sort((a, b) => chronoCompare(a.key, b.key));
    return {
      indicatorId,
      indicatorName: name,
      indicatorType: type,
      trend: classifyTrend(sorted.map(({ label, value }) => ({ label, value })), LEVEL_STABLE),
    };
  });

  // ---- 3. CBC sub-strand competency trend (per exam, band-based) ----
  const { data: cmRows, error: cmError } = await supabase
    .from("competency_marks")
    .select(
      "sub_strand_id, exam_id, curriculum_sub_strands(name, curriculum_strands(subjects(name))), grading_scale_bands(points, level_order, grading_scale_id), exams(name, created_at, terms(term_number, academic_years(start_date)))",
    )
    .eq("student_id", studentId);
  if (cmError) return { error: cmError.message };

  const subStrandSeries = new Map<
    string,
    { name: string; subjectName: string; points: { key: ChronoKey; label: string; value: number }[] }
  >();
  for (const r of cmRows ?? []) {
    const subStrand = r.curriculum_sub_strands as unknown as {
      name: string;
      curriculum_strands: { subjects: { name: string } | null } | null;
    } | null;
    const band = r.grading_scale_bands as unknown as { points: number | null; level_order: number; grading_scale_id: string } | null;
    const exam = r.exams as unknown as {
      name: string;
      created_at: string;
      terms: { term_number: number; academic_years: { start_date: string } | null } | null;
    } | null;
    const value = band ? bandValue(band) : null;
    if (!subStrand || !band || value === null || !exam?.terms?.academic_years) continue;
    const entry = subStrandSeries.get(r.sub_strand_id) ?? {
      name: subStrand.name,
      subjectName: subStrand.curriculum_strands?.subjects?.name ?? "—",
      points: [],
    };
    entry.points.push({
      key: { yearStart: exam.terms.academic_years.start_date, termNumber: exam.terms.term_number, examCreatedAt: exam.created_at },
      label: exam.name,
      value,
    });
    subStrandSeries.set(r.sub_strand_id, entry);
  }

  const subStrandCompetencies: SubStrandGrowth[] = [...subStrandSeries.entries()].map(
    ([subStrandId, { name, subjectName, points }]) => {
      const sorted = points.sort((a, b) => chronoCompare(a.key, b.key));
      return {
        subStrandId,
        subStrandName: name,
        subjectName,
        trend: classifyTrend(sorted.map(({ label, value }) => ({ label, value })), LEVEL_STABLE),
      };
    },
  );

  return { subjects, coreCompetencies, subStrandCompetencies };
}
