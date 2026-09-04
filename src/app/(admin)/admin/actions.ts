"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";

type ActionResult = { error: string } | { success: true };

// Lightweight lifecycle controls surfaced directly on the Overview school list -- the
// heavier billing/actions.ts pair (activateSchoolSubscription/suspendSchoolSubscription)
// still exists for full plan-change workflows on /admin/billing; these two are the quick
// "shut it off" / "turn it back on" levers for the common non-payment case, so a suspension
// no longer needs a SQL console or a trip to Billing's expanded row.
export async function suspendSchool(schoolId: string, reason: string): Promise<ActionResult> {
  const supabase = await createClient();
  const { error } = await supabase.rpc("suspend_subscription", {
    p_school_id: schoolId,
    p_reason: reason || null,
  });
  if (error) return { error: error.message };
  revalidatePath("/admin");
  revalidatePath("/admin/billing");
  return { success: true };
}

export async function reactivateSchool(schoolId: string): Promise<ActionResult> {
  const supabase = await createClient();
  const { error } = await supabase.rpc("reactivate_school", { p_school_id: schoolId });
  if (error) return { error: error.message };
  revalidatePath("/admin");
  revalidatePath("/admin/billing");
  return { success: true };
}
