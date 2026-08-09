"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";

type ActionResult = { error: string } | { success: true };
type IssueApiKeyResult = { error: string } | { success: true; raw_key: string; key_prefix: string };

// Group-level branding (Phase 5 Item 2). whitelabel_enabled itself is not editable here —
// it's a platform (super_admin) entitlement, enforced by prevent_whitelabel_self_escalation()
// at the DB level regardless of what this form sends.
export async function updateGroupBranding(input: {
  logo_url?: string;
  primary_color?: string;
  custom_domain?: string;
}): Promise<ActionResult> {
  const supabase = await createClient();
  const { data: groupId, error: groupIdError } = await supabase.rpc("auth_group_id");
  if (groupIdError || !groupId) return { error: "Could not resolve your school group." };

  const { error } = await supabase
    .from("school_groups")
    .update({
      logo_url: input.logo_url || null,
      primary_color: input.primary_color || null,
      custom_domain: input.custom_domain || null,
    })
    .eq("id", groupId);
  if (error) return { error: error.message };

  revalidatePath("/campuses");
  return { success: true };
}

// Group-scoped API keys (Phase 5 Item 3) — same read-only rules as school-scoped keys in
// /app/settings/actions.ts, just issued against the group instead of a single school.
export async function issueGroupApiKey(input: {
  name: string;
  scopes: string[];
}): Promise<IssueApiKeyResult> {
  const supabase = await createClient();
  const { data: groupId, error: groupIdError } = await supabase.rpc("auth_group_id");
  if (groupIdError || !groupId) return { error: "Could not resolve your school group." };

  const { data, error } = await supabase
    .rpc("issue_api_key", {
      p_name: input.name,
      p_scopes: input.scopes,
      p_school_id: null,
      p_school_group_id: groupId,
      p_expires_at: null,
    })
    .single();

  if (error || !data) return { error: error?.message ?? "Could not create the API key." };
  const issued = data as { id: string; raw_key: string; key_prefix: string };

  revalidatePath("/campuses");
  return { success: true, raw_key: issued.raw_key, key_prefix: issued.key_prefix };
}

export async function revokeGroupApiKey(id: string): Promise<ActionResult> {
  const supabase = await createClient();
  const { data: schoolUser } = await supabase
    .from("school_users")
    .select("id")
    .eq("auth_user_id", (await supabase.auth.getUser()).data.user?.id ?? "")
    .maybeSingle();

  const { error } = await supabase
    .from("api_keys")
    .update({ status: "revoked", revoked_at: new Date().toISOString(), revoked_by: schoolUser?.id })
    .eq("id", id);
  if (error) return { error: error.message };
  revalidatePath("/campuses");
  return { success: true };
}
