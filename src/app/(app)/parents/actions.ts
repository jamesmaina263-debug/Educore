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
