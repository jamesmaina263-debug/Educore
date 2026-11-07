import type { PctMark, ScoreKind } from "@/lib/academics/performance-analytics";

// Converts the database's pre-aggregated rows (performance_group_aggregates / performance_student_aggregates,
// migration 20261106090100) into weighted rows the calculation layer understands: score = the mean of the
// marks the row stands for, weight = how many marks that is. summarizeSchool() then gives exactly the answer
// it would from the individual marks (pinned by performance-aggregates.test.ts).

export interface GroupAggregateRow {
  class_id: string;
  class_name: string;
  subject_id: string;
  subject_name: string;
  year_id: string;
  year_name: string;
  year_start: string;
  term_number: number;
  kind: ScoreKind;
  grading_scale_id: string | null;
  level_count: number | null;
  n: number | string;
  score_sum: number | string;
}

export interface StudentAggregateRow {
  student_id: string;
  class_id: string;
  class_name: string;
  year_id: string;
  year_name: string;
  year_start: string;
  term_number: number;
  kind: ScoreKind;
  grading_scale_id: string | null;
  level_count: number | null;
  n: number | string;
  score_sum: number | string;
}

/** Student rows have no subject: the subject filter is applied in the database. */
export const ALL_SUBJECTS = "*";

function base(r: GroupAggregateRow | StudentAggregateRow) {
  const n = Number(r.n);
  return {
    classId: r.class_id,
    classLabel: r.class_name,
    yearId: r.year_id,
    yearName: r.year_name,
    yearStart: r.year_start,
    termNumber: Number(r.term_number),
    examId: "",
    kind: r.kind,
    rawScore: null,
    maxScore: null,
    levelOrder: null,
    levelCount: r.kind === "level" ? r.level_count : null,
    levelPoints: null,
    levelLabel: null,
    scaleId: r.kind === "level" ? r.grading_scale_id : null,
    score: Number(r.score_sum) / n,
    weight: n,
  };
}

export function groupRowToMark(r: GroupAggregateRow): PctMark {
  return { ...base(r), studentId: ALL_SUBJECTS, subjectId: r.subject_id, subjectName: r.subject_name };
}

export function studentRowToMark(r: StudentAggregateRow): PctMark {
  return { ...base(r), studentId: r.student_id, subjectId: ALL_SUBJECTS, subjectName: "All subjects" };
}

/** Drops rows that stand for no marks, so a malformed row can never divide by zero. */
export const validAggregate = (r: { n: number | string }): boolean => Number(r.n) > 0;
