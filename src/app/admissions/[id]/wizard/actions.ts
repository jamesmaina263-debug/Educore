"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";

type ActionResult = { error: string } | { success: true };

// Autosave checkpoint — fires on step transitions (Next/Back), not per keystroke (Brief 4.16.11:
// "not on every keystroke"). Phase 11 only persists *which step* the officer reached; each step's
// actual field data is Phase 12's responsibility once real forms exist for Academics/Boarding/
// Transport/Health/Finance.
export async function saveWizardStep(applicationId: string, step: number): Promise<ActionResult> {
  const supabase = await createClient();
  const { error } = await supabase
    .from("applications")
    .update({ wizard_current_step: step, updated_at: new Date().toISOString() })
    .eq("id", applicationId);
  if (error) return { error: error.message };
  revalidatePath("/admissions");
  revalidatePath(`/admissions/${applicationId}/wizard`);
  return { success: true };
}

export async function discardDraft(applicationId: string): Promise<ActionResult> {
  const supabase = await createClient();
  const { data: application } = await supabase.from("applications").select("status").eq("id", applicationId).single();
  if (!application || application.status !== "draft") {
    return { error: "Only drafts can be discarded." };
  }
  const { error } = await supabase.from("applications").delete().eq("id", applicationId);
  if (error) return { error: error.message };
  revalidatePath("/admissions");
  return { success: true };
}
