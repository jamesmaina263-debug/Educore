"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { tagSentryRequestContext } from "@/lib/observability/sentry-context";
import { validateTraining, type TrainingInput } from "@/lib/staff/training";

type ActionResult = { error: string } | { success: true };

// Staff training records. Each action is a thin call to a database function that checks the caller
// (staff.manage), the school, the staff member and the feature flag itself. Nothing here touches
// contracts, qualifications or pay, and nothing sends a message.

export async function saveTrainingAction(input: TrainingInput): Promise<ActionResult> {
  const checked = validateTraining(input);
  if ("error" in checked) return { error: checked.error };
  const t = checked.value;
  const supabase = await createClient();
  await tagSentryRequestContext(supabase);
  const { error } = await supabase.rpc("save_staff_training_record", {
    p_id: t.id,
    p_staff_id: t.staffId,
    p_title: t.title,
    p_provider: t.provider.trim() || null,
    p_category: t.category,
    p_status: t.status,
    p_start_date: t.startDate,
    p_end_date: t.endDate || null,
    p_hours: checked.hours,
    p_expires_on: t.expiresOn || null,
    p_certificate_document_id: null,
    p_notes: t.notes.trim() || null,
  });
  if (error) return { error: error.message };
  revalidatePath("/staff/training");
  return { success: true };
}

export async function cancelTrainingAction(id: string): Promise<ActionResult> {
  if (!id) return { error: "Missing training record." };
  const supabase = await createClient();
  await tagSentryRequestContext(supabase);
  const { error } = await supabase.rpc("cancel_staff_training_record", { p_id: id });
  if (error) return { error: error.message };
  revalidatePath("/staff/training");
  return { success: true };
}
