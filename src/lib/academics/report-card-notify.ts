import type { createClient } from "@/lib/supabase/server";

// Staff in-app notifications for the report-card workflow. This is only the caller side: who is told,
// what the message says and how duplicates are avoided are all decided in notify_report_card_event()
// (migration 20261031200000), which reads the real state from report_cards and delivers through the
// existing notify_school_user() -> notification_logs -> topbar bell path.
//
// It is BEST-EFFORT by design, like every other workflow notification in the app: a failure here must
// never fail or slow down the action that triggered it, so errors are swallowed.

type Client = Awaited<ReturnType<typeof createClient>>;

export type ReportCardEvent = "ready_for_comments" | "awaiting_approval" | "needs_reapproval" | "approved";

export interface ReportCardEventScope {
  event: ReportCardEvent;
  examId: string;
  /** Exactly one of these: a whole class, one stream, or one learner's stream. */
  classId?: string;
  streamId?: string;
  studentId?: string;
}

export async function notifyReportCardEvent(supabase: Pick<Client, "rpc">, scope: ReportCardEventScope): Promise<void> {
  try {
    await supabase.rpc("notify_report_card_event", {
      p_event: scope.event,
      p_exam_id: scope.examId,
      p_class_id: scope.classId ?? null,
      p_stream_id: scope.streamId ?? null,
      p_student_id: scope.studentId ?? null,
    });
  } catch {
    // Never let a notification problem affect the action that triggered it.
  }
}
