import { csvSafe } from "@/lib/accounting-export";

// WP 7.7: the simple custom report builder. Staff choose a dataset and the columns they want and download a
// CSV. Read-only: it adds no tables and writes nothing; every row comes through the caller's own RLS, so it
// can never show more than the same person can already see in the app. Learner details are limited to the
// roster basics (no birth certificate, UPI, date of birth or guardian contacts); marks are approved marks only.

export type ReportDataset = "learners" | "marks";

export interface ColumnDef {
  key: string;
  label: string;
}

export const LEARNER_COLUMNS: ColumnDef[] = [
  { key: "admission_number", label: "Admission number" },
  { key: "first_name", label: "First name" },
  { key: "other_names", label: "Other names" },
  { key: "last_name", label: "Last name" },
  { key: "gender", label: "Gender" },
  { key: "class", label: "Class" },
  { key: "status", label: "Status" },
  { key: "admission_date", label: "Admission date" },
];

export const MARK_COLUMNS: ColumnDef[] = [
  { key: "exam", label: "Exam" },
  { key: "class", label: "Class" },
  { key: "admission_number", label: "Admission number" },
  { key: "learner", label: "Learner" },
  { key: "subject", label: "Subject" },
  { key: "score", label: "Score" },
  { key: "grade", label: "Grade" },
];

export const MAX_REPORT_ROWS = 5000;

export function columnsFor(dataset: ReportDataset): ColumnDef[] {
  return dataset === "learners" ? LEARNER_COLUMNS : MARK_COLUMNS;
}

export function isReportDataset(value: unknown): value is ReportDataset {
  return value === "learners" || value === "marks";
}

/** Keeps the caller's order, drops duplicates, and rejects anything not in the dataset's whitelist. */
export function validateColumns(dataset: ReportDataset, keys: unknown): { error: string } | { columns: ColumnDef[] } {
  if (!Array.isArray(keys) || keys.length === 0) return { error: "Choose at least one column." };
  const allowed = new Map(columnsFor(dataset).map((c) => [c.key, c]));
  const seen = new Set<string>();
  const out: ColumnDef[] = [];
  for (const k of keys) {
    if (typeof k !== "string" || !allowed.has(k)) return { error: "One of the chosen columns is not available." };
    if (!seen.has(k)) {
      seen.add(k);
      out.push(allowed.get(k)!);
    }
  }
  return { columns: out };
}

type One<T> = T | T[] | null | undefined;
const one = <T,>(v: One<T>): T | null => (Array.isArray(v) ? (v[0] ?? null) : (v ?? null));
const fullName = (r: { first_name?: string | null; other_names?: string | null; last_name?: string | null }) =>
  [r.first_name, r.other_names, r.last_name].filter(Boolean).join(" ");

export interface LearnerRow {
  admission_number: string | null;
  first_name: string | null;
  other_names: string | null;
  last_name: string | null;
  gender: string | null;
  status: string | null;
  admission_date: string | null;
  streams?: One<{ name: string; classes?: One<{ name: string }> }>;
}

export interface MarkRow {
  raw_score: number | string | null;
  subjects?: One<{ name: string }>;
  grading_scale_bands?: One<{ label: string }>;
  students?: One<{ admission_number: string | null; first_name: string | null; other_names: string | null; last_name: string | null; streams?: One<{ name: string; classes?: One<{ name: string }> }> }>;
  exams?: One<{ name: string }>;
}

function classLabel(streams: LearnerRow["streams"]): string {
  const st = one(streams);
  if (!st) return "";
  const cls = one(st.classes)?.name ?? "";
  return `${cls} ${st.name}`.trim();
}

export function learnerRecord(row: LearnerRow): Record<string, string> {
  return {
    admission_number: row.admission_number ?? "",
    first_name: row.first_name ?? "",
    other_names: row.other_names ?? "",
    last_name: row.last_name ?? "",
    gender: row.gender ?? "",
    class: classLabel(row.streams),
    status: row.status ?? "",
    admission_date: row.admission_date ?? "",
  };
}

export function markRecord(row: MarkRow): Record<string, string> {
  const st = one(row.students);
  return {
    exam: one(row.exams)?.name ?? "",
    class: classLabel(st?.streams),
    admission_number: st?.admission_number ?? "",
    learner: st ? fullName(st) : "",
    subject: one(row.subjects)?.name ?? "",
    score: row.raw_score === null || row.raw_score === undefined ? "" : String(Number(row.raw_score)),
    grade: one(row.grading_scale_bands)?.label ?? "",
  };
}

/** Records -> uniform CSV rows with the chosen columns, labelled and protected against formula injection. */
export function toCsvRows(records: Record<string, string>[], columns: ColumnDef[]): Record<string, string>[] {
  return records.map((rec) => Object.fromEntries(columns.map((c) => [c.label, csvSafe(rec[c.key] ?? "")])));
}
