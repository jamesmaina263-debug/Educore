"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { tagSentryRequestContext } from "@/lib/observability/sentry-context";

const HEAD_COMMENT_MAX_CHARS = 1000; // not exported: a "use server" file may only export async functions

// Saves (or, with blank text, clears) the head teacher's comment on a report card, ONLY through
// set_report_card_head_comment(): it re-checks report_cards.comment_head and that the card belongs
// to the caller's own school, and the table has no direct write policy at all. The checks here just
// give a friendly error before the round trip; no AI is involved in this comment.
export async function saveHeadTeacherComment(reportCardId: string, comment: string): Promise<{ error: string } | { success: true }> {
  if (typeof reportCardId !== "string" || !reportCardId.trim()) return { error: "Missing report card." };
  if (typeof comment !== "string") return { error: "Invalid comment." };
  if (comment.trim().length > HEAD_COMMENT_MAX_CHARS) return { error: `The head teacher comment is limited to ${HEAD_COMMENT_MAX_CHARS} characters.` };

  const supabase = await createClient();
  await tagSentryRequestContext(supabase);
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: "You must be signed in." };

  const { error } = await supabase.rpc("set_report_card_head_comment", { p_report_card_id: reportCardId, p_comment: comment });
  if (error) {
    if (/not authorized/i.test(error.message)) return { error: "You don't have permission to write the head teacher comment." };
    if (/not found/i.test(error.message)) return { error: "Report card not found." };
    return { error: "Could not save the head teacher comment. Please try again." };
  }

  revalidatePath("/exams/report-cards");
  revalidatePath("/portal");
  return { success: true };
}
