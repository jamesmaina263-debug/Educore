import type { createClient } from "@/lib/supabase/server";
import type { PerfMark } from "@/lib/academics/performance-analytics";
import {
  groupRowToMark,
  studentRowToMark,
  validAggregate,
  type GroupAggregateRow,
  type StudentAggregateRow,
} from "@/lib/academics/performance-aggregates";
import type { PctMark } from "@/lib/academics/performance-analytics";

// Read-only loaders for the Academic Performance Analytics module. Both go through database functions
// (migrations 20261106090000-20261106090200) and run as the signed-in user:
//
//  * loadStudentPerformanceMarks: ONE student's multi-year results, via get_student_performance_marks.
//    That function returns exactly the marks the caller may already read (staff with exams.read, or a
//    guardian / the student themselves once the report card is released) plus the year, term, paper
//    maximum and band names that guardians and students cannot join to directly under RLS.
//  * loadPerformanceAggregates: the whole school (or a teacher's classes), summed in the database
//    (performance_group_aggregates / performance_student_aggregates) instead of transferring every mark.
//
// Only closed exams count. Rows that cannot be placed are counted in `skipped`; a result cut off at the row
// cap sets `truncated`, so the UI says so instead of presenting a smaller picture as the whole one.

type Client = Awaited<ReturnType<typeof createClient>>;

const PAGE = 1000;
export const MAX_ROWS = 100_000;
export const MAX_AGGREGATE_ROWS = 200_000;

/** Page through an RPC that returns a set, up to `cap` rows, reporting whether the cap cut it short. */
async function pageRpc<T>(fetchPage: (from: number, to: number) => PromiseLike<{ data: T[] | null; error: { message: string } | null }>, cap: number): Promise<{ rows: T[]; truncated: boolean }> {
  const rows: T[] = [];
  for (let from = 0; ; from += PAGE) {
    if (from >= cap) return { rows, truncated: true };
    const { data, error } = await fetchPage(from, from + PAGE - 1);
    if (error) throw new Error(`Query failed: ${error.message}`);
    const page = data ?? [];
    rows.push(...page);
    if (page.length < PAGE) return { rows, truncated: false };
  }
}

// ------------------------------------------------------------------- one student

export interface StudentMarkRow {
  student_id: string;
  class_id: string;
  class_name: string;
  subject_id: string;
  subject_name: string;
  exam_id: string;
  exam_name: string | null;
  raw_score: number | string | null;
  max_score: number | string | null;
  band_label: string | null;
  band_points: number | string | null;
  band_level_order: number | null;
  band_scale_id: string | null;
  level_count: number | null;
  term_number: number;
  year_id: string;
  year_name: string;
  year_start: string;
}

const num = (v: number | string | null): number | null => {
  if (v === null || v === undefined) return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};

/**
 * Maps the function's rows. A mark with a raw score is a PERCENT mark; only a mark with no raw score is a
 * CBC level mark. The order matters: numeric-model marks also carry a derived band, so checking the band
 * first would score every numeric mark as a CBC level.
 */
export function mapStudentRows(rows: StudentMarkRow[]): { marks: PerfMark[]; skipped: number } {
  const marks: PerfMark[] = [];
  let skipped = 0;
  for (const r of rows) {
    const base = {
      studentId: r.student_id,
      classId: r.class_id,
      classLabel: r.class_name ?? "Unknown class",
      subjectId: r.subject_id,
      subjectName: r.subject_name ?? "Unknown subject",
      yearId: r.year_id,
      yearName: r.year_name,
      yearStart: r.year_start,
      termNumber: Number(r.term_number),
      examId: r.exam_id,
      examName: r.exam_name ?? undefined,
    };
    const raw = num(r.raw_score);
    if (raw !== null) {
      marks.push({ ...base, kind: "percent", rawScore: raw, maxScore: num(r.max_score), levelOrder: null, levelCount: null, levelPoints: null, levelLabel: null });
    } else if (r.band_label !== null && r.band_level_order !== null) {
      if (r.level_count === null) {
        skipped++; // scale size unknown: cannot score honestly
        continue;
      }
      marks.push({ ...base, kind: "level", rawScore: null, maxScore: null, levelOrder: r.band_level_order, levelCount: r.level_count, levelPoints: num(r.band_points), levelLabel: r.band_label });
    }
  }
  return { marks, skipped };
}

export interface LoadedStudentMarks {
  marks: PerfMark[];
  skipped: number;
  truncated: boolean;
}

export async function loadStudentPerformanceMarks(supabase: Client, studentId: string): Promise<LoadedStudentMarks> {
  const { rows, truncated } = await pageRpc<StudentMarkRow>(
    (from, to) => supabase.rpc("get_student_performance_marks", { p_student_id: studentId }).range(from, to) as unknown as PromiseLike<{ data: StudentMarkRow[] | null; error: { message: string } | null }>,
    MAX_ROWS,
  );
  return { ...mapStudentRows(rows), truncated };
}

// ------------------------------------------------------------------- whole school

export interface LoadAggregateOptions {
  /** Restrict to these classes (teacher scope). An empty array returns nothing. */
  classIds?: string[];
  /** Filters applied in the database to the per-student rows. */
  classId?: string;
  subjectId?: string;
}

export interface LoadedAggregates {
  /** One row per student x class x year x term x model, already limited to the chosen class / subject. */
  studentMarks: PctMark[];
  /** One row per class x subject x year x term x model. */
  groupMarks: PctMark[];
  truncated: boolean;
}

export async function loadPerformanceAggregates(supabase: Client, opts: LoadAggregateOptions = {}): Promise<LoadedAggregates> {
  if (opts.classIds && opts.classIds.length === 0) return { studentMarks: [], groupMarks: [], truncated: false };
  const scope = opts.classIds ?? null;

  const [groups, students] = await Promise.all([
    pageRpc<GroupAggregateRow>(
      (from, to) => supabase.rpc("performance_group_aggregates", { p_class_ids: scope }).range(from, to) as unknown as PromiseLike<{ data: GroupAggregateRow[] | null; error: { message: string } | null }>,
      MAX_AGGREGATE_ROWS,
    ),
    pageRpc<StudentAggregateRow>(
      (from, to) =>
        supabase
          .rpc("performance_student_aggregates", { p_class_ids: scope, p_class_id: opts.classId ?? null, p_subject_id: opts.subjectId ?? null })
          .range(from, to) as unknown as PromiseLike<{ data: StudentAggregateRow[] | null; error: { message: string } | null }>,
      MAX_AGGREGATE_ROWS,
    ),
  ]);

  return {
    groupMarks: groups.rows.filter(validAggregate).map(groupRowToMark),
    studentMarks: students.rows.filter(validAggregate).map(studentRowToMark),
    truncated: groups.truncated || students.truncated,
  };
}
