import type { createClient } from "@/lib/supabase/server";
import type { PerfMark } from "@/lib/academics/performance-analytics";

// Read-only loader for the Academic Performance Analytics module. It runs through the caller's own
// Supabase session, so existing RLS decides which marks come back; no service role lives here.
//
// What is returned:
//  - numeric marks (raw_score + the paper's maximum from exam_subjects) as kind "percent";
//  - CBC band marks (band_id) as kind "level", with the scale's level count so the pure layer can score
//    them (see performance-analytics.ts);
//  - only marks from CLOSED exams: open exams are still being entered and would make a year look weaker.
//
// What is NOT hidden: any row that cannot be placed (its term/year is not readable by this viewer, or a
// level mark's scale size is unknown) is counted in `skipped`, and a result cut off at MAX_ROWS sets
// `truncated`, so the UI can say so instead of showing a smaller picture as if it were the whole one.

type Client = Awaited<ReturnType<typeof createClient>>;

const PAGE = 1000;
export const MAX_ROWS = 100_000;

interface Year {
  id: string;
  name: string;
  start_date: string;
}
interface TermShape {
  term_number: number;
  academic_years: Year | Year[] | null;
}
interface Band {
  label: string;
  points: number | string | null;
  level_order: number;
  grading_scale_id: string;
}
interface Row {
  student_id: string;
  class_id: string;
  subject_id: string;
  exam_id: string;
  raw_score: number | null;
  band_id: string | null;
  subjects: { name: string } | { name: string }[] | null;
  classes: { name: string } | { name: string }[] | null;
  exam_subjects: { max_score: number } | { max_score: number }[] | null;
  grading_scale_bands: Band | Band[] | null;
  exams: { name: string | null; terms: TermShape | TermShape[] | null } | { name: string | null; terms: TermShape | TermShape[] | null }[] | null;
}

const one = <T,>(v: T | T[] | null | undefined): T | null => (Array.isArray(v) ? (v[0] ?? null) : (v ?? null));

export interface LoadedPerformanceMarks {
  marks: PerfMark[];
  /** Rows read but not usable for this viewer (unreadable term/year, unknown scale size). */
  skipped: number;
  /** True when the row cap was reached, so the figures cover only part of the data. */
  truncated: boolean;
}

export interface LoadOptions {
  studentId?: string;
  /** Restrict to these classes (teacher scope). An empty array returns nothing. */
  classIds?: string[];
}

export function mapRows(rows: Row[], levelCounts: Map<string, number>): { marks: PerfMark[]; skipped: number } {
  const marks: PerfMark[] = [];
  let skipped = 0;
  for (const r of rows) {
    const term = one(one(r.exams)?.terms ?? null);
    const year = one(term?.academic_years ?? null);
    if (!term || !year) {
      skipped++;
      continue;
    }
    const base = {
      studentId: r.student_id,
      classId: r.class_id,
      classLabel: one(r.classes)?.name ?? "Unknown class",
      subjectId: r.subject_id,
      subjectName: one(r.subjects)?.name ?? "Unknown subject",
      yearId: year.id,
      yearName: year.name,
      yearStart: year.start_date,
      termNumber: term.term_number,
      examId: r.exam_id,
      examName: one(r.exams)?.name ?? undefined,
    };
    const band = one(r.grading_scale_bands);
    if (r.band_id && band) {
      const count = levelCounts.get(band.grading_scale_id) ?? null;
      if (count === null) {
        skipped++;
        continue;
      }
      const points = band.points === null ? null : Number(band.points);
      marks.push({ ...base, kind: "level", rawScore: null, maxScore: null, levelOrder: band.level_order, levelCount: count, levelPoints: Number.isFinite(points) ? points : null, levelLabel: band.label });
    } else if (r.raw_score !== null) {
      marks.push({ ...base, kind: "percent", rawScore: r.raw_score, maxScore: one(r.exam_subjects)?.max_score ?? null, levelOrder: null, levelCount: null, levelPoints: null, levelLabel: null });
    }
  }
  return { marks, skipped };
}

export async function loadPerformanceMarks(supabase: Client, opts: LoadOptions = {}): Promise<LoadedPerformanceMarks> {
  if (opts.classIds && opts.classIds.length === 0) return { marks: [], skipped: 0, truncated: false };

  const rows: Row[] = [];
  let truncated = false;
  for (let from = 0; ; from += PAGE) {
    if (from >= MAX_ROWS) {
      truncated = true;
      break;
    }
    let q = supabase
      .from("marks")
      .select(
        "student_id, class_id, subject_id, exam_id, raw_score, band_id, subjects(name), classes(name), exam_subjects(max_score), grading_scale_bands(label, points, level_order, grading_scale_id), exams!inner(name, status, terms(term_number, academic_years(id, name, start_date)))",
      )
      .eq("exams.status", "closed")
      .or("raw_score.not.is.null,band_id.not.is.null");
    if (opts.studentId) q = q.eq("student_id", opts.studentId);
    if (opts.classIds) q = q.in("class_id", opts.classIds);
    const { data, error } = (await q.order("id", { ascending: true }).range(from, from + PAGE - 1)) as unknown as {
      data: Row[] | null;
      error: { message: string } | null;
    };
    if (error) throw new Error(`Query failed: ${error.message}`);
    const page = data ?? [];
    rows.push(...page);
    if (page.length < PAGE) break;
  }

  // Number of levels per scale: needed to score a level mark (best level = count ... worst = 1).
  const scaleIds = [...new Set(rows.map((r) => one(r.grading_scale_bands)?.grading_scale_id).filter((x): x is string => !!x))];
  const levelCounts = new Map<string, number>();
  if (scaleIds.length > 0) {
    const { data, error } = await supabase.from("grading_scale_bands").select("grading_scale_id, level_order").in("grading_scale_id", scaleIds);
    if (error) throw new Error(`Query failed: ${error.message}`);
    for (const b of (data ?? []) as { grading_scale_id: string; level_order: number }[]) {
      levelCounts.set(b.grading_scale_id, Math.max(levelCounts.get(b.grading_scale_id) ?? 0, b.level_order));
    }
  }

  return { ...mapRows(rows, levelCounts), truncated };
}
