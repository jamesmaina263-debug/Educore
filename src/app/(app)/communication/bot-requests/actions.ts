"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { tagSentryRequestContext } from "@/lib/observability/sentry-context";
import { isDecision } from "@/lib/bot-requests";

type ActionResult = { error: string } | { success: true };

// One thin call to bot_review_request(), which checks the caller, the school, the feature flag and the
// permission for that kind of request itself (attendance.mark for an absence note, students.write to
// change a phone number). An absence note never edits the attendance register.
export async function reviewBotRequestAction(id: string, decision: string, note: string): Promise<ActionResult> {
  if (!isDecision(decision)) return { error: "Unknown decision." };
  const supabase = await createClient();
  await tagSentryRequestContext(supabase);
  const { error } = await supabase.rpc("bot_review_request", {
    p_request_id: id,
    p_decision: decision,
    p_note: note.trim() ? note.trim().slice(0, 300) : null,
  });
  if (error) return { error: error.message };
  revalidatePath("/communication/bot-requests");
  return { success: true };
}
