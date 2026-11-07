"use server";

import { createClient } from "@/lib/supabase/server";
import { selectInChunks } from "@/lib/academics/in-chunks";
import { loadPerformanceAggregates } from "@/lib/academics/load-performance-marks";
import { resolveScopeForCurrentUser } from "@/lib/academics/analytics-scope";
import { resolveThreshold, type AnalyticsSettings, type ThresholdSource } from "@/lib/academics/analytics-settings";
import {
  buildEarlyWarnings,
  configFor,
  levelBandsFromScale,
  summarizeSchool,
  wcount,
  type AnalyticsConfig,
  type EarlyWarningRow,
  type GradeBand,
  type PctMark,
  type ScoreKind,
  type SchoolFilter,
  type SchoolSummary,
} from "@/lib/academics/performance-analytics";

export interface NamedWarning extends EarlyWarningRow {
  name: string;
  admissionNumber: string;
  band: string | null;
}

export type SchoolAnalyticsFilter = SchoolFilter & {
  band?: string;
  kind?: ScoreKind;
  /** One-off threshold from the URL; beats the school's saved default. */
  threshold?: number;
  saved: AnalyticsSettings;
};

export interface SchoolAnalytics {
  /** "school" = everything; "classes" = only the viewer's own classes (teacher scope). */
  scope: "school" | "classes";
  kind: ScoreKind;
  /** Models that have data in scope. Percentages and CBC levels are never averaged together. */
  availableKinds: ScoreKind[];
  config: AnalyticsConfig;
  thresholdSource: ThresholdSource;
  summary: SchoolSummary;
  /** Early-warning indicators for the filtered scope, weakest first. Indicators to investigate, not verdicts. */
  warnings: NamedWarning[];
  options: {
    years: { id: string; name: string }[];
    classes: { id: string; name: string }[];
    subjects: { id: string; name: string }[];
  };
  /** Where the category breakdown comes from, or null when none could be built. */
  bandSource: string | null;
  /** True when even the database-summed data exceeded the row cap, so figures cover only part of it. */
  truncated: boolean;
}

/**
 * Whole-school (or own-classes) analytics. Marks are summed inside the database
 * (performance_group_aggregates / performance_student_aggregates, run as the caller so RLS applies), so the
 * page scales with the number of students and terms rather than the number of individual marks. Access is
 * resolved in analytics-scope.ts. All arithmetic lives in performance-analytics.ts, and
 * performance-aggregates.test.ts proves this path equals the per-mark path.
 */
export async function getSchoolAnalytics(filter: SchoolAnalyticsFilter): Promise<SchoolAnalytics | { denied: true } | { error: string }> {
  try {
    const supabase = await createClient();
    const scope = await resolveScopeForCurrentUser(supabase);
    if (scope.level === "none") return { denied: true };

    const loaded = await loadPerformanceAggregates(supabase, {
      classIds: scope.level === "classes" ? scope.classIds : undefined,
      classId: filter.classId,
      subjectId: filter.subjectId,
    });

    const kindWeight = (k: ScoreKind) => wcount(loaded.groupMarks.filter((m) => m.kind === k));
    const availableKinds = (["percent", "level"] as ScoreKind[]).filter((k) => kindWeight(k) > 0);
    const kind: ScoreKind = filter.kind && availableKinds.includes(filter.kind) ? filter.kind : [...availableKinds].sort((a, b) => kindWeight(b) - kindWeight(a))[0] ?? "percent";
    const groups = loaded.groupMarks.filter((m) => m.kind === kind);
    const students = loaded.studentMarks.filter((m) => m.kind === kind);

    const maxLevels = Math.max(0, ...groups.map((m) => m.levelCount ?? 0)) || 4;
    const base = configFor(kind, maxLevels);
    const { value: wanted, source: thresholdSource } = resolveThreshold(kind, filter.threshold, filter.saved, (v) => v > base.min && v <= base.max);
    const config = wanted !== undefined ? configFor(kind, maxLevels, wanted) : base;

    let bands: GradeBand[] = [];
    let bandSource: string | null = null;
    if (kind === "level") {
      // bands come from the grading scale the marks use (the one with the most marks if classes differ)
      const weightByScale = new Map<string, number>();
      for (const m of groups) if (m.scaleId) weightByScale.set(m.scaleId, (weightByScale.get(m.scaleId) ?? 0) + (m.weight ?? 1));
      const topScale = [...weightByScale.entries()].sort((a, b) => b[1] - a[1])[0]?.[0];
      if (topScale) {
        const { data } = await supabase.from("grading_scale_bands").select("label, level_order, points").eq("grading_scale_id", topScale).order("level_order", { ascending: true });
        bands = levelBandsFromScale((data ?? []) as { label: string; level_order: number; points: number | string | null }[]);
        bandSource = bands.length > 0 ? "CBC levels" : null;
      }
    } else {
      const { data: scale } = await supabase.from("grading_scales").select("id, name").eq("is_default", true).eq("model_type", "numeric").maybeSingle();
      if (scale) {
        const { data: bandRows } = await supabase
          .from("grading_scale_bands")
          .select("label, min_score, max_score, level_order")
          .eq("grading_scale_id", scale.id)
          .not("min_score", "is", null)
          .not("max_score", "is", null)
          .order("level_order", { ascending: true });
        bands = (bandRows ?? []).map((b) => ({ label: b.label as string, min: Number(b.min_score), max: Number(b.max_score), order: b.level_order as number }));
        bandSource = scale.name;
      }
    }

    const summary = summarizeSchool(students, filter, bands, config, 3, groups);
    const bandByStudent = new Map(summary.students.map((x) => [x.studentId, x.band]));
    // Student rows are already limited to the chosen class and subject in the database; year and term apply here.
    const scoped: PctMark[] = students.filter((m) => (!filter.yearId || m.yearId === filter.yearId) && (!filter.classId || m.classId === filter.classId) && (!filter.termNumber || m.termNumber === filter.termNumber));
    const rawWarnings = buildEarlyWarnings(scoped, config).filter((w) => !filter.band || bandByStudent.get(w.studentId) === filter.band);
    const people = await selectInChunks<{ id: string; first_name: string; last_name: string; admission_number: string | null }>(
      rawWarnings.map((w) => w.studentId),
      200,
      (ids) => supabase.from("students").select("id, first_name, last_name, admission_number").in("id", ids),
    );
    const personById = new Map(people.map((x) => [x.id, x]));
    const warnings: NamedWarning[] = rawWarnings.map((w) => {
      const person = personById.get(w.studentId);
      return {
        ...w,
        name: person ? `${person.first_name} ${person.last_name}` : "Student",
        admissionNumber: person?.admission_number ?? "—",
        band: bandByStudent.get(w.studentId) ?? null,
      };
    });

    const uniq = (pairs: [string, string][]) => [...new Map(pairs).entries()].map(([id, name]) => ({ id, name }));
    const years = [...new Map(groups.map((m) => [m.yearId, { id: m.yearId, name: m.yearName, start: m.yearStart }])).values()]
      .sort((a, b) => b.start.localeCompare(a.start))
      .map(({ id, name }) => ({ id, name }));

    return {
      scope: scope.level,
      kind,
      availableKinds,
      config,
      thresholdSource,
      summary,
      warnings,
      options: {
        years,
        classes: uniq(groups.map((m) => [m.classId, m.classLabel])).sort((a, b) => a.name.localeCompare(b.name)),
        subjects: uniq(groups.map((m) => [m.subjectId, m.subjectName])).sort((a, b) => a.name.localeCompare(b.name)),
      },
      bandSource,
      truncated: loaded.truncated,
    };
  } catch (e) {
    return { error: e instanceof Error ? e.message : "Could not load school analytics." };
  }
}
