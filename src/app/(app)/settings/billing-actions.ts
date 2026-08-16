"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";

type ActionResult = { error: string } | { success: true };

export async function cancelOwnSubscription(): Promise<ActionResult> {
  const supabase = await createClient();
  const { data: schoolId, error: schoolIdError } = await supabase.rpc("auth_school_id");
  if (schoolIdError || !schoolId) return { error: "Could not resolve your school." };

  const { error } = await supabase.rpc("cancel_subscription", {
    p_school_id: schoolId,
    p_reason: "Cancelled by school owner from Settings.",
  });
  if (error) return { error: error.message };

  revalidatePath("/settings");
  return { success: true };
}
