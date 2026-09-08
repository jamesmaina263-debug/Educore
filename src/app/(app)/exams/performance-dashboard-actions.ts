"use server";

import { createClient } from "@/lib/supabase/server";
import { classifyTrend, type TrendResult } from "@/lib/academics/growth-trend";

// ---------------------------------------------------------------------------
// Final performance dashboard (Performance Appraisal Engine directive,
// roadmap Step 12 -- the last step in the directive's own recommended
// sequence). Pulls together, for one class + exam, everything the earlier
// steps already built rather than introducing new calculation logic:
//   - achievement distribution: same band-counting idea as
//     report-card-insights.ts, aggregated across the whole class instead of
//     one student
//   - core-competency distribution: competency_indicator_ratings (Step 5/6)
//     for the exam's term, aggregated
//   - growth: bulk-computed subject trend tally (Step 8's classifyTrend,
//     reused as-is) -- computed in a handful of bulk queries across the
//     whole roster at once, NOT one getStudentGrowth() call per student.
//     Step 10's commit message flagged that per-row N+1 as a known gap for
//     the whole-class report-card list; this is the bulk-friendly version
//     that gap called for.
//   - intervention list: v_at_risk_students (existing, now extended in this
//     same PR with a competency-based 4th rule), filtered to this class --
//     not recomputed here.
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

export interface DistributionBand {
  label: string;
  levelOrder: number;
  count: number;
}

export interface GrowthTally {
  improving: number;
  declining: number;
  stable: number;
  insufficientData: number;
}

export interface InterventionRow {
  studentId: string;
  fullName: string;
  reasons: string[];
  needsSupportCompetencies: string[];
}

export interface ClassPerformanceDashboard {
  achievementDistribution: DistributionBand[];
  competencyDistribution: DistributionBand[];
  growth: GrowthTally;
  interventions: InterventionRow[];
}

export async function getClassPerformanceDashboard(
  examId: string,
  classId: string,
): Promise<ClassPerformanceDashboard | { error: string }> {
  const supabase = await createClient();

  const { data: examRow, error: examError } = await supabase.from("exams").select("term_id").eq("id", examId).maybeSingle();
  if (examError) return { error: examError.message };
  if (!examRow) return { error: "Exam not found." };

  const { data: streamRows } = await supabase.from("streams").select("id").eq("class_id", classId);
  const streamIds = (streamRows ?? []).map((s) => s.id);
  const { data: students } = streamIds.length
    ? await supabase.from("students").select("id, first_name, last_name").in("current_class_id", streamIds).eq("status", "active")
    : { data: [] as { id: string; first_name: string; last_name: string }[] };
  const studentIds = (students ?? []).map((s) => s.id);

  // ---- Achievement distribution: this exam's marks bands, class-wide ----
  const { data: marksRows } = studentIds.length
    ? await supabase
        .from("marks")
        .select("grading_scale_bands(label, level_order)")
        .eq("exam_id", examId)
        .eq("class_id", classId)
    : { data: [] };
  const achievementMap = new Map<string, DistributionBand>();
  for (const m of marksRows ?? []) {
    const band = m.grading_scale_bands as unknown as { label: string; level_order: number } | null;
    if (!band) continue;
    const existing = achievementMap.get(band.label);
    if (existing) existing.count += 1;
    else achievementMap.set(band.label, { label: band.label, levelOrder: band.level_order, count: 1 });
  }

  // ---- Core-competency distribution: this exam's term, class-wide ----
  const { data: indicatorRows } = studentIds.length
    ? await supabase
        .from("competency_indicator_ratings")
        .select("grading_scale_bands(label, level_order)")
        .eq("term_id", examRow.term_id)
        .in("student_id", studentIds)
    : { data: [] };
  const competencyMap = new Map<string, DistributionBand>();
  for (const r of indicatorRows ?? []) {
    const band = r.grading_scale_bands as unknown as { label: string; level_order: number } | null;
    if (!band) continue;
    const existing = competencyMap.get(band.label);
    if (existing) existing.count += 1;
    else competencyMap.set(band.label, { label: band.label, levelOrder: band.level_order, count: 1 });
  }

  // ---- Growth: bulk fetch this roster's full marks history in a handful of
  // queries (not per-student), same shape as getStudentGrowth but tallied. ----
  const growth: GrowthTally = { improving: 0, declining: 0, stable: 0, insufficientData: 0 };
  if (studentIds.length) {
    const { data: historyRows } = await supabase
      .from("marks")
      .select(
        "student_id, subject_id, exam_id, class_id, raw_score, exams(name, created_at, terms(term_number, academic_years(start_date)))",
      )
      .in("student_id", studentIds)
      .not("raw_score", "is", null);

    const examIds = [...new Set((historyRows ?? []).map((r) => r.exam_id))];
    const { data: examSubjectRows } = examIds.length
      ? await supabase.from("exam_subjects").select("exam_id, class_id, subject_id, max_score").in("exam_id", examIds)
      : { data: [] as { exam_id: string; class_id: string; subject_id: string; max_score: number }[] };
    const maxScoreByKey = new Map<string, number>();
    for (const es of examSubjectRows ?? []) {
      maxScoreByKey.set(`${es.exam_id}|${es.class_id}|${es.subject_id}`, es.max_score as number);
    }

    const seriesByStudentSubject = new Map<string, { key: ChronoKey; value: number }[]>();
    for (const r of historyRows ?? []) {
      const exam = r.exams as unknown as {
        name: string;
        created_at: string;
        terms: { term_number: number; academic_years: { start_date: string } | null } | null;
      } | null;
      if (!exam?.terms?.academic_years || r.raw_score === null) continue;
      const maxScore = maxScoreByKey.get(`${r.exam_id}|${r.class_id}|${r.subject_id}`);
      if (!maxScore) continue;
      const seriesKey = `${r.student_id}|${r.subject_id}`;
      const list = seriesByStudentSubject.get(seriesKey) ?? [];
      list.push({
        key: { yearStart: exam.terms.academic_years.start_date, termNumber: exam.terms.term_number, examCreatedAt: exam.created_at },
        value: (r.raw_score / maxScore) * 100,
      });
      seriesByStudentSubject.set(seriesKey, list);
    }

    for (const series of seriesByStudentSubject.values()) {
      const sorted = series.sort((a, b) => chronoCompare(a.key, b.key));
      const trend: TrendResult = classifyTrend(sorted.map((p, i) => ({ label: String(i), value: p.value })));
      if (trend.direction === "improving") growth.improving += 1;
      else if (trend.direction === "declining") growth.declining += 1;
      else if (trend.direction === "stable") growth.stable += 1;
      else growth.insufficientData += 1;
    }
  }

  // ---- Interventions: reuse v_at_risk_students, filtered to this class ----
  const { data: riskRows, error: riskError } = await supabase
    .from("v_at_risk_students")
    .select("student_id, first_name, last_name, risk_reasons, needs_support_competencies")
    .eq("current_class_id", classId);
  if (riskError) return { error: riskError.message };
  const interventions: InterventionRow[] = (riskRows ?? []).map((r) => ({
    studentId: r.student_id,
    fullName: `${r.first_name} ${r.last_name}`,
    reasons: r.risk_reasons ?? [],
    needsSupportCompetencies: r.needs_support_competencies ?? [],
  }));

  return {
    achievementDistribution: [...achievementMap.values()].sort((a, b) => b.levelOrder - a.levelOrder),
    competencyDistribution: [...competencyMap.values()].sort((a, b) => b.levelOrder - a.levelOrder),
    growth,
    interventions,
  };
}
