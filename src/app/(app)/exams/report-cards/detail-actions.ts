"use server";

import { createClient } from "@/lib/supabase/server";
import { tagSentryRequestContext } from "@/lib/observability/sentry-context";
import { loadReportCardDetail as loadDetail, type ReportCardDetail } from "@/lib/academics/load-report-card-detail";

// Read-only. Loads one student's full report-card review data when a row is expanded, under the
// caller's own session, so RLS decides what is visible exactly as it does for the page itself.
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function getReportCardDetail(
  examId: string,
  classId: string,
  studentId: string,
): Promise<{ error: string } | { detail: ReportCardDetail }> {
  if (![examId, classId, studentId].every((v) => typeof v === "string" && UUID.test(v))) {
    return { error: "Invalid request." };
  }
  const supabase = await createClient();
  await tagSentryRequestContext(supabase);
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: "Your session has expired. Please sign in again." };

  try {
    return { detail: await loadDetail(supabase, { examId, classId, studentId }) };
  } catch {
    return { error: "Couldn't load this report card. Please try again." };
  }
}
