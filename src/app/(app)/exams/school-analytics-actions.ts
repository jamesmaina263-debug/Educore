"use server";

import { createClient } from "@/lib/supabase/server";
import { loadPerformanceMarks } from "@/lib/academics/load-performance-marks";
import { normaliseMarks, summarizeSchool, type GradeBand, type SchoolFilter, type SchoolSummary } from "@/lib/academics/performance-analytics";

export interface SchoolAnalytics {
  summary: SchoolSummary;
  options: {
    years: { id: string; name: string }[];
    classes: { id: string; name: string }[];
    subjects: { id: string; name: string }[];
  };
  /** Bands come from the school's default numeric grading scale, not a hardcoded list. Empty if none is configured. */
  bandSource: string | null;
  interventionThreshold: number;
}

/**
 * Whole-school analytics, computed live from closed-exam marks through the caller's own session (RLS
 * decides visibility; the page also gates on ai.read like the existing Performance Dashboard). All
 * arithmetic lives in performance-analytics.ts.
 */
export async function getSchoolAnalytics(filter: SchoolFilter): Promise<SchoolAnalytics | { error: string }> {
  try {
    const supabase = await createClient();
    const [raw, { data: scale }] = await Promise.all([
      loadPerformanceMarks(supabase),
      supabase.from("grading_scales").select("id, name").eq("is_default", true).eq("model_type", "numeric").maybeSingle(),
    ]);
    const marks = normaliseMarks(raw);

    let bands: GradeBand[] = [];
    if (scale) {
      const { data: bandRows } = await supabase
        .from("grading_scale_bands")
        .select("label, min_score, max_score, level_order")
        .eq("grading_scale_id", scale.id)
        .not("min_score", "is", null)
        .not("max_score", "is", null)
        .order("level_order", { ascending: true });
      bands = (bandRows ?? []).map((b) => ({ label: b.label as string, min: Number(b.min_score), max: Number(b.max_score), order: b.level_order as number }));
    }

    const uniq = (pairs: [string, string][]) => [...new Map(pairs).entries()].map(([id, name]) => ({ id, name }));
    const years = [...new Map(marks.map((m) => [m.yearId, { id: m.yearId, name: m.yearName, start: m.yearStart }])).values()]
      .sort((a, b) => b.start.localeCompare(a.start))
      .map(({ id, name }) => ({ id, name }));

    return {
      summary: summarizeSchool(marks, filter, bands),
      options: {
        years,
        classes: uniq(marks.map((m) => [m.classId, m.classLabel])).sort((a, b) => a.name.localeCompare(b.name)),
        subjects: uniq(marks.map((m) => [m.subjectId, m.subjectName])).sort((a, b) => a.name.localeCompare(b.name)),
      },
      bandSource: scale?.name ?? null,
      interventionThreshold: 50,
    };
  } catch (e) {
    return { error: e instanceof Error ? e.message : "Could not load school analytics." };
  }
}
