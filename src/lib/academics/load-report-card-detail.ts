import type { createClient } from "@/lib/supabase/server";
import { buildReportCardInsights, type ReportCardInsights } from "@/lib/academics/report-card-insights";

// One student's full report-card review data, loaded only when a row is expanded on the Report Cards
// page. This is the per-student form of what the page used to fetch for the whole class up front, with
// the same queries, the same band/insight rules and the same RLS (it runs under the caller's session),
// so an expanded row shows exactly what the old always-open panel did.

type Client = Awaited<ReturnType<typeof createClient>>;

export interface StudentMarkLine {
  subject_name: string;
  raw_score: number | null;
  band_label: string | null;
}

export interface CompetencyLine {
  subject_name: string;
  strand_name: string;
  sub_strand_name: string;
  band_label: string;
}

export interface ReportCardDetail {
  marks: StudentMarkLine[];
  competency: CompetencyLine[];
  insights: ReportCardInsights;
  report_card: {
    id: string;
    head_comment: string | null;
    comment: string | null;
    comment_source: "none" | "ai" | "teacher_approved" | "teacher_written";
  } | null;
}

type Band = { label: string; level_order: number; grading_scale_id: string } | null;

export async function loadReportCardDetail(
  supabase: Client,
  params: { examId: string; classId: string; studentId: string },
): Promise<ReportCardDetail> {
  const { examId, classId, studentId } = params;

  const [{ data: examRow }, { data: marksRows }, { data: competencyRows }, { data: cardRow }] = await Promise.all([
    supabase.from("exams").select("term_id").eq("id", examId).maybeSingle(),
    supabase
      .from("marks")
      .select("student_id, raw_score, subjects(name), grading_scale_bands(label, level_order, grading_scale_id)")
      .eq("exam_id", examId)
      .eq("class_id", classId)
      .eq("student_id", studentId),
    supabase
      .from("competency_marks")
      .select(
        "student_id, grading_scale_bands(label, level_order, grading_scale_id), curriculum_sub_strands(name, curriculum_strands(name, subjects(name)))",
      )
      .eq("exam_id", examId)
      .eq("class_id", classId)
      .eq("student_id", studentId),
    supabase.from("report_cards").select("id, comment, comment_source").eq("exam_id", examId).eq("class_id", classId).eq("student_id", studentId).maybeSingle(),
  ]);

  // Core-competency/value/PCI ratings are term-scoped, not exam-scoped.
  const [{ data: indicatorRows }, { data: headCommentRow }] = await Promise.all([
    examRow?.term_id
      ? supabase
          .from("competency_indicator_ratings")
          .select("student_id, competency_indicators(name), grading_scale_bands(label, level_order, grading_scale_id)")
          .eq("term_id", examRow.term_id)
          .eq("student_id", studentId)
      : Promise.resolve({ data: [] as never[] }),
    cardRow?.id
      ? supabase.from("report_card_head_comments").select("report_card_id, comment").eq("report_card_id", cardRow.id as string).maybeSingle()
      : Promise.resolve({ data: null }),
  ]);

  const scaleIds = new Set<string>();
  for (const m of marksRows ?? []) {
    const band = m.grading_scale_bands as unknown as Band;
    if (band) scaleIds.add(band.grading_scale_id);
  }
  for (const c of competencyRows ?? []) {
    const band = c.grading_scale_bands as unknown as Band;
    if (band) scaleIds.add(band.grading_scale_id);
  }
  for (const r of indicatorRows ?? []) {
    const band = (r as { grading_scale_bands: unknown }).grading_scale_bands as Band;
    if (band) scaleIds.add(band.grading_scale_id);
  }
  const { data: allBandsForScales } = scaleIds.size
    ? await supabase.from("grading_scale_bands").select("grading_scale_id, level_order").in("grading_scale_id", [...scaleIds])
    : { data: [] };
  const maxLevelOrderByScale = new Map<string, number>();
  for (const b of allBandsForScales ?? []) {
    maxLevelOrderByScale.set(b.grading_scale_id, Math.max(maxLevelOrderByScale.get(b.grading_scale_id) ?? 0, b.level_order));
  }

  const marks: StudentMarkLine[] = (marksRows ?? [])
    .map((m) => ({
      subject_name: (m.subjects as unknown as { name: string } | null)?.name ?? "",
      raw_score: m.raw_score as number | null,
      band_label: (m.grading_scale_bands as unknown as { label: string } | null)?.label ?? null,
    }))
    .sort((a, b) => a.subject_name.localeCompare(b.subject_name));

  const competency: CompetencyLine[] = (competencyRows ?? []).map((c) => {
    const subStrand = c.curriculum_sub_strands as unknown as {
      name: string;
      curriculum_strands: { name: string; subjects: { name: string } | null } | null;
    } | null;
    const strand = subStrand?.curriculum_strands ?? null;
    return {
      subject_name: strand?.subjects?.name ?? "",
      strand_name: strand?.name ?? "",
      sub_strand_name: subStrand?.name ?? "",
      band_label: (c.grading_scale_bands as unknown as { label: string } | null)?.label ?? "—",
    };
  });

  // Achievement distribution + Strengths/Areas for Support: same inputs and rules the page used per
  // row (marks + competency bands + this term's indicator ratings). Growth-trend signals stay out here
  // for the same reason as before: they cost extra queries per learner.
  const achievementBands = [
    ...(marksRows ?? []).flatMap((m) => {
      const band = m.grading_scale_bands as unknown as Band;
      return band ? [{ label: band.label, levelOrder: band.level_order }] : [];
    }),
    ...(competencyRows ?? []).flatMap((c) => {
      const band = c.grading_scale_bands as unknown as Band;
      return band ? [{ label: band.label, levelOrder: band.level_order }] : [];
    }),
  ];
  const competencyRatings = [
    ...(competencyRows ?? []).flatMap((c) => {
      const subStrand = c.curriculum_sub_strands as unknown as { name: string } | null;
      const band = c.grading_scale_bands as unknown as Band;
      if (!subStrand || !band) return [];
      return [
        {
          name: subStrand.name,
          label: band.label,
          levelOrder: band.level_order,
          maxLevelOrder: maxLevelOrderByScale.get(band.grading_scale_id) ?? band.level_order,
        },
      ];
    }),
    ...(indicatorRows ?? []).flatMap((r) => {
      const row = r as { competency_indicators: unknown; grading_scale_bands: unknown };
      const indicator = row.competency_indicators as { name: string } | null;
      const band = row.grading_scale_bands as Band;
      if (!indicator || !band) return [];
      return [
        {
          name: indicator.name,
          label: band.label,
          levelOrder: band.level_order,
          maxLevelOrder: maxLevelOrderByScale.get(band.grading_scale_id) ?? band.level_order,
        },
      ];
    }),
  ];

  return {
    marks,
    competency,
    insights: buildReportCardInsights({ achievementBands, competencyRatings, improvingSubjects: [], decliningSubjects: [] }),
    report_card: cardRow
      ? {
          id: cardRow.id as string,
          head_comment: (headCommentRow as { comment: string } | null)?.comment ?? null,
          comment: cardRow.comment as string | null,
          comment_source: cardRow.comment_source as "none" | "ai" | "teacher_approved" | "teacher_written",
        }
      : null,
  };
}
