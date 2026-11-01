"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { tagSentryRequestContext } from "@/lib/observability/sentry-context";
import { describeSendOutcome, validateSchedule, type ReminderSchedule } from "@/lib/fee-reminders";

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
    p_template_id: s.templateId,
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
  // The database re-checks opt-out, phone, the live balance (including payments not yet allocated)
  // and any payment in progress at the moment of sending. Anything other than "sent" means nothing
  // went out; say exactly why.
  const outcome = describeSendOutcome(String(data));
  if (!outcome.ok) return { error: outcome.message };
  return { success: true };
}

export async function refreshReminderAction(id: string): Promise<ActionResult> {
  const supabase = await createClient();
  await tagSentryRequestContext(supabase);
  const { data, error } = await supabase.rpc("refresh_fee_reminder", { p_id: id });
  if (error) return { error: error.message };
  revalidatePath("/finance/reminders");
  if (data === "cancelled") return { error: "Nothing is owing any more, so this reminder was cancelled." };
  return { success: true };
}
