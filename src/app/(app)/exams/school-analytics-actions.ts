"use server";

import { createClient } from "@/lib/supabase/server";
import { selectInChunks } from "@/lib/academics/in-chunks";
import { loadPerformanceMarks } from "@/lib/academics/load-performance-marks";
import { resolveScopeForCurrentUser } from "@/lib/academics/analytics-scope";
import {
  buildEarlyWarnings,
  configFor,
  levelBands,
  normaliseMarks,
  summarizeSchool,
  type AnalyticsConfig,
  type EarlyWarningRow,
  type GradeBand,
  type ScoreKind,
  type SchoolFilter,
  type SchoolSummary,
} from "@/lib/academics/performance-analytics";

export interface NamedWarning extends EarlyWarningRow {
  name: string;
  admissionNumber: string;
  band: string | null;
}

export type SchoolAnalyticsFilter = SchoolFilter & { band?: string; kind?: ScoreKind; threshold?: number };

export interface SchoolAnalytics {
  /** "school" = everything; "classes" = only the viewer's own classes (teacher scope). */
  scope: "school" | "classes";
  kind: ScoreKind;
  /** Models that have data in scope. Percentages and CBC levels are never averaged together. */
  availableKinds: ScoreKind[];
  config: AnalyticsConfig;
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
  /** Rows read but unusable for this viewer, and whether the row cap cut the data short. */
  skipped: number;
  truncated: boolean;
}

/**
 * Whole-school (or own-classes) analytics, computed live from closed-exam marks through the caller's own
 * session. Access is resolved in analytics-scope.ts (verified against the live RLS). All arithmetic lives
 * in performance-analytics.ts.
 */
export async function getSchoolAnalytics(filter: SchoolAnalyticsFilter): Promise<SchoolAnalytics | { denied: true } | { error: string }> {
  try {
    const supabase = await createClient();
    const scope = await resolveScopeForCurrentUser(supabase);
    if (scope.level === "none") return { denied: true };

    const loaded = await loadPerformanceMarks(supabase, scope.level === "classes" ? { classIds: scope.classIds } : {});
    const all = normaliseMarks(loaded.marks);

    const availableKinds = (["percent", "level"] as ScoreKind[]).filter((k) => all.some((m) => m.kind === k));
    const count = (k: ScoreKind) => all.filter((m) => m.kind === k).length;
    const kind: ScoreKind =
      filter.kind && availableKinds.includes(filter.kind) ? filter.kind : availableKinds.sort((a, b) => count(b) - count(a))[0] ?? "percent";
    const marks = all.filter((m) => m.kind === kind);

    const maxLevels = Math.max(0, ...marks.map((m) => m.levelCount ?? 0)) || 4;
    const base = configFor(kind, maxLevels);
    const t = filter.threshold;
    const config = t !== undefined && Number.isFinite(t) && t > base.min && t <= base.max ? configFor(kind, maxLevels, t) : base;

    let bands: GradeBand[] = [];
    let bandSource: string | null = null;
    if (kind === "level") {
      bands = levelBands(marks);
      bandSource = bands.length > 0 ? "CBC levels" : null;
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

    const summary = summarizeSchool(marks, filter, bands, config);
    const bandByStudent = new Map(summary.students.map((x) => [x.studentId, x.band]));
    const scoped = marks.filter(
      (m) =>
        (!filter.yearId || m.yearId === filter.yearId) &&
        (!filter.classId || m.classId === filter.classId) &&
        (!filter.subjectId || m.subjectId === filter.subjectId) &&
        (!filter.termNumber || m.termNumber === filter.termNumber),
    );
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
    const years = [...new Map(marks.map((m) => [m.yearId, { id: m.yearId, name: m.yearName, start: m.yearStart }])).values()]
      .sort((a, b) => b.start.localeCompare(a.start))
      .map(({ id, name }) => ({ id, name }));

    return {
      scope: scope.level,
      kind,
      availableKinds,
      config,
      summary,
      warnings,
      options: {
        years,
        classes: uniq(marks.map((m) => [m.classId, m.classLabel])).sort((a, b) => a.name.localeCompare(b.name)),
        subjects: uniq(marks.map((m) => [m.subjectId, m.subjectName])).sort((a, b) => a.name.localeCompare(b.name)),
      },
      bandSource,
      skipped: loaded.skipped,
      truncated: loaded.truncated,
    };
  } catch (e) {
    return { error: e instanceof Error ? e.message : "Could not load school analytics." };
  }
}
