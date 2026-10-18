"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { tagSentryRequestContext } from "@/lib/observability/sentry-context";
import { logAdminAction } from "@/lib/log-admin-action";
import { isUuid } from "@/lib/sales/pipeline";
import { validateCheckinInput } from "@/lib/growth/trial-checkins";

type ActionResult = { error: string } | { success: true };

/**
 * Record that a person checked in with a trial school. Manual and self-reported: nothing is sent and no
 * subscription changes. The database function re-checks super admin and that the school has a subscription.
 * The audit log gets ids and the coded channel/outcome only, never the note or any contact detail.
 */
export async function logTrialCheckin(
  schoolId: string,
  channel: string,
  outcome: string,
  performedBy: string | null,
  note?: string,
): Promise<ActionResult> {
  if (!isUuid(schoolId)) return { error: "Invalid school id." };
  if (performedBy !== null && !isUuid(performedBy)) return { error: "Invalid team member." };
  const checked = validateCheckinInput(channel, outcome, note);
  if (!checked.ok) return { error: checked.error };

  const supabase = await createClient();
  await tagSentryRequestContext(supabase);
  const { error } = await supabase.rpc("admin_log_trial_checkin", {
    p_school_id: schoolId,
    p_channel: checked.channel,
    p_outcome: checked.outcome,
    p_performed_by: performedBy,
    p_note: checked.note,
  });
  if (error) return { error: error.message };

  void logAdminAction(supabase, "log_trial_checkin", {
    school_id: schoolId,
    channel: checked.channel,
    outcome: checked.outcome,
  });
  revalidatePath("/admin/trials");
  return { success: true };
}
