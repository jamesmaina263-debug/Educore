"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";

type ActionResult = { error: string } | { success: true };

// Wraps delete_school_user_permanently (20260823044534) -- until now nothing in the
// app called it, so there was no actual way for management to remove a guardian's
// account/PII once created, even though the DB-level capability already existed.
// The RPC itself re-checks guardians.delete server-side and rejects staff accounts,
// so this is safe to expose directly off the current session.
export async function deleteGuardianPermanentlyAction(guardianId: string): Promise<ActionResult> {
  const supabase = await createClient();
  const { error } = await supabase.rpc("delete_school_user_permanently", {
    p_school_user_id: guardianId,
    p_reason: "Deleted from Parents directory",
  });
  if (error) return { error: error.message };
  revalidatePath("/parents", "layout");
  return { success: true };
}

// Wraps merge_guardian_accounts (20260823044534) -- the correct fix for two
// accounts that should be one (the same parent registered twice): reassigns
// the duplicate's children/bookings/applications/notifications onto the
// account being kept, then deletes the now-empty duplicate. Prefer this over
// deleteGuardianPermanentlyAction whenever the account being removed has real
// history (children, etc.) that shouldn't just be lost.
export async function mergeGuardianAccountsAction(keepId: string, duplicateId: string): Promise<ActionResult> {
  const supabase = await createClient();
  const { error } = await supabase.rpc("merge_guardian_accounts", {
    p_keep_id: keepId,
    p_duplicate_id: duplicateId,
    p_reason: "Merged from Parents directory",
  });
  if (error) return { error: error.message };
  revalidatePath("/parents", "layout");
  return { success: true };
}
