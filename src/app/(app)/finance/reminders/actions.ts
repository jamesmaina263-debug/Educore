"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { tagSentryRequestContext } from "@/lib/observability/sentry-context";
import { validateSchedule, type ReminderSchedule } from "@/lib/fee-reminders";

type ActionResult = { error: string } | { success: true };

// Scheduled fee reminders (Finance > Reminders). Every action is a thin call to a database function
// that checks the caller, the school and the feature flag itself. Nothing here sends a message
// except approveReminderAction, which a finance user triggers one reminder at a time.

export async function saveScheduleAction(input: ReminderSchedule): Promise<ActionResult> {
  const checked = validateSchedule(input);
  if ("error" in checked) return { error: checked.error };
  const s = checked.value;
  const supabase = await createClient();
  await tagSentryRequestContext(supabase);
  const { error } = await supabase.rpc("set_fee_reminder_schedule", {
    p_enabled: s.enabled,
    p_frequency: s.frequency,
    p_run_weekday: s.runWeekday,
    p_run_day_of_month: s.runDayOfMonth,
    p_channel: s.channel,
    p_min_balance: s.minBalance,
    p_min_days_between: s.minDaysBetween,
  });
  if (error) return { error: error.message };
  revalidatePath("/finance/reminders");
  return { success: true };
}

export async function draftNowAction(): Promise<{ error: string } | { success: true; created: number }> {
  const supabase = await createClient();
  await tagSentryRequestContext(supabase);
  const { data, error } = await supabase.rpc("generate_fee_reminders", { p_force: true });
  if (error) return { error: error.message };
  revalidatePath("/finance/reminders");
  return { success: true, created: typeof data === "number" ? data : 0 };
}

export async function updateReminderDraftAction(id: string, body: string): Promise<ActionResult> {
  const supabase = await createClient();
  await tagSentryRequestContext(supabase);
  const { error } = await supabase.rpc("update_fee_reminder_draft", { p_id: id, p_body: body });
  if (error) return { error: error.message };
  revalidatePath("/finance/reminders");
  return { success: true };
}

export async function dismissReminderAction(id: string, reason: string): Promise<ActionResult> {
  const supabase = await createClient();
  await tagSentryRequestContext(supabase);
  const { error } = await supabase.rpc("dismiss_fee_reminder", { p_id: id, p_reason: reason || null });
  if (error) return { error: error.message };
  revalidatePath("/finance/reminders");
  return { success: true };
}

export async function approveReminderAction(id: string): Promise<ActionResult> {
  const supabase = await createClient();
  await tagSentryRequestContext(supabase);
  const { data, error } = await supabase.rpc("send_fee_reminder", { p_id: id });
  if (error) return { error: error.message };
  revalidatePath("/finance/reminders");
  // false = the database refused to queue it (guardian opted out, no phone, or the balance was
  // cleared since the draft was made). The draft is dismissed with the reason; tell the person.
  if (data === false) {
    return { error: "Not sent: the guardian opted out, has no phone number, or the balance has been cleared. The draft was dismissed with the reason." };
  }
  return { success: true };
}
