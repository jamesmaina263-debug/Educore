"use server";

import { createClient } from "@/lib/supabase/server";
import { tagSentryRequestContext } from "@/lib/observability/sentry-context";
import { hasFeatureFlag } from "@/lib/feature-flags";
import { REPORT_FORM_FLAG } from "@/lib/academics/report-form-layout";
import { selectAllPages } from "@/lib/academics/in-chunks";
import { buildCsv } from "@/lib/csv-export";
import {
  MAX_REPORT_ROWS,
  isReportDataset,
  learnerRecord,
  markRecord,
  toCsvRows,
  validateColumns,
  type LearnerRow,
  type MarkRow,
} from "@/lib/academics/custom-report";

export interface RunReportInput {
  dataset: string;
  columns: string[];
  /** learners: optional stream filter */
  streamId?: string | null;
  /** marks: the exam (required) */
  examId?: string | null;
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// Builds the CSV on the server so the permission and flag checks cannot be skipped by the browser. Rows come
// through the caller's own RLS (never a service role), capped at MAX_REPORT_ROWS.
export async function runCustomReport(input: RunReportInput): Promise<{ error: string } | { csv: string; rows: number; truncated: boolean }> {
  if (!input || !isReportDataset(input.dataset)) return { error: "Choose a report type." };
  const dataset = input.dataset;
  const cols = validateColumns(dataset, input.columns);
  if ("error" in cols) return cols;
  if (input.streamId && !UUID_RE.test(input.streamId)) return { error: "Invalid class." };
  if (input.examId && !UUID_RE.test(input.examId)) return { error: "Invalid exam." };
  if (dataset === "marks" && !input.examId) return { error: "Choose an exam." };

  const supabase = await createClient();
  await tagSentryRequestContext(supabase);
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: "You must be signed in." };
  if (!(await hasFeatureFlag(supabase, REPORT_FORM_FLAG))) return { error: "The report builder is not enabled for this school." };

  const permission = dataset === "learners" ? "students.read" : "exams.read";
  const { data: allowed } = await supabase.rpc("auth_has_permission", { p_permission_key: permission });
  if (allowed !== true) return { error: "You don't have permission to build this report." };

  try {
    let records: Record<string, string>[];
    if (dataset === "learners") {
      const rows = await selectAllPages<LearnerRow>(
        (from, to) => {
          let q = supabase
            .from("students")
            .select("admission_number, first_name, other_names, last_name, gender, status, admission_date, streams(name, classes(name))")
            .eq("status", "active")
            .order("last_name")
            .order("first_name")
            .order("id")
            .range(from, to);
          if (input.streamId) q = q.eq("current_class_id", input.streamId);
          return q as unknown as PromiseLike<{ data: LearnerRow[] | null; error: { message: string } | null }>;
        },
        1000,
        Math.ceil(MAX_REPORT_ROWS / 1000) + 1,
      );
      records = rows.map(learnerRecord);
    } else {
      const rows = await selectAllPages<MarkRow>(
        (from, to) =>
          supabase
            .from("marks")
            .select("raw_score, subjects(name), grading_scale_bands(label), exams(name), students(admission_number, first_name, other_names, last_name, streams(name, classes(name)))")
            .eq("exam_id", input.examId as string)
            .eq("status", "approved")
            .order("student_id")
            .order("subject_id")
            .order("id")
            .range(from, to) as unknown as PromiseLike<{ data: MarkRow[] | null; error: { message: string } | null }>,
        1000,
        Math.ceil(MAX_REPORT_ROWS / 1000) + 1,
      );
      records = rows.map(markRecord);
    }
    const truncated = records.length > MAX_REPORT_ROWS;
    const limited = truncated ? records.slice(0, MAX_REPORT_ROWS) : records;
    if (limited.length === 0) return { error: "No rows match these choices." };
    const csv = await buildCsv(toCsvRows(limited, cols.columns));
    return { csv, rows: limited.length, truncated };
  } catch {
    return { error: "Could not build the report. Please try again." };
  }
}
