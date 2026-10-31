"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { tagSentryRequestContext } from "@/lib/observability/sentry-context";
import { selectInChunks, chunk } from "@/lib/academics/in-chunks";
import { selectBulkApprovable } from "@/lib/academics/report-card-status";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

type Row = { id: string; student_id: string; comment: string | null; comment_source: string };

/**
 * Approve every pending comment in ONE stream: AI drafts waiting for approval, and cards a mark
 * correction reset (they keep their text). Approving RELEASES a card to the parent portal and queues
 * the one-time guardian SMS (notify_guardians_on_report_card_release), so:
 *   - the learners are decided here, on the server, from current data (never from a client list), and
 *   - a card with no comment text is never approved.
 * Permission is the same as approving one card: report_cards RLS only lets approve_any holders update
 * any stream and class teachers update their own, so rows the caller can't approve are left untouched
 * and reported as skipped. Nothing is written by this action beyond comment_source/approved_by/approved_at.
 */
export async function approveStreamComments(input: {
  exam_id: string;
  class_id: string;
  stream_id: string;
}): Promise<{ error: string } | { approved: number; skipped: number }> {
  if (![input.exam_id, input.class_id, input.stream_id].every((v) => typeof v === "string" && UUID.test(v))) {
    return { error: "Invalid request." };
  }
  const supabase = await createClient();
  await tagSentryRequestContext(supabase);
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: "Your session has expired. Please sign in again." };
  const { data: schoolUser } = await supabase.from("school_users").select("id").eq("auth_user_id", user.id).maybeSingle();

  try {
    // Same population as the class page: active students currently in this stream.
    const { data: roster } = await supabase
      .from("students")
      .select("id")
      .eq("current_class_id", input.stream_id)
      .eq("status", "active");
    const rosterIds = (roster ?? []).map((r) => r.id as string);
    if (rosterIds.length === 0) return { approved: 0, skipped: 0 };

    const cards = await selectInChunks<Row>(rosterIds, 100, (ids) =>
      supabase
        .from("report_cards")
        .select("id, student_id, comment, comment_source")
        .eq("exam_id", input.exam_id)
        .eq("class_id", input.class_id)
        .in("student_id", ids)
        .in("comment_source", ["ai", "none"]),
    );
    const eligible = selectBulkApprovable(cards);
    if (eligible.length === 0) return { approved: 0, skipped: 0 };

    const approvedAt = new Date().toISOString();
    let approved = 0;
    // Small batches: each approval fires the release-notification trigger, and the API statement
    // timeout is short. The comment_source guard makes a card that changed since we read it a no-op.
    for (const ids of chunk(
      eligible.map((c) => c.id),
      25,
    )) {
      const { data: updated, error } = await supabase
        .from("report_cards")
        .update({ comment_source: "teacher_approved", approved_by: schoolUser?.id ?? null, approved_at: approvedAt })
        .in("id", ids)
        .in("comment_source", ["ai", "none"])
        .select("id");
      if (error) {
        revalidatePath("/exams/report-cards");
        return { error: `Approved ${approved} before an error: ${error.message}` };
      }
      approved += updated?.length ?? 0;
    }

    revalidatePath("/exams/report-cards");
    if (approved === 0) return { error: "You don't have permission to approve these report cards." };
    return { approved, skipped: eligible.length - approved };
  } catch {
    return { error: "Couldn't approve the comments. Please try again." };
  }
}
