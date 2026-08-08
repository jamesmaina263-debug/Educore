"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";

type ActionResult = { error: string } | { success: true };

// Both actions rely on prevent_whitelabel_self_escalation() at the DB layer to actually
// enforce super_admin-only -- these are just the app-side entry points. A non-super_admin
// calling either of these gets the DB's own rejection message back as `error`.

export async function setWhitelabelEnabled(groupId: string, enabled: boolean): Promise<ActionResult> {
  const supabase = await createClient();
  const { error } = await supabase
    .from("school_groups")
    .update({ whitelabel_enabled: enabled })
    .eq("id", groupId);
  if (error) return { error: error.message };
  revalidatePath("/admin/whitelabel");
  return { success: true };
}

export async function setDomainVerified(groupId: string): Promise<ActionResult> {
  const supabase = await createClient();
  const { error } = await supabase
    .from("school_groups")
    .update({ custom_domain_status: "verified" })
    .eq("id", groupId);
  if (error) return { error: error.message };
  revalidatePath("/admin/whitelabel");
  return { success: true };
}

export async function setDomainPending(groupId: string): Promise<ActionResult> {
  const supabase = await createClient();
  const { error } = await supabase
    .from("school_groups")
    .update({ custom_domain_status: "pending" })
    .eq("id", groupId);
  if (error) return { error: error.message };
  revalidatePath("/admin/whitelabel");
  return { success: true };
}
