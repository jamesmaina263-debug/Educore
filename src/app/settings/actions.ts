"use server";

import { randomBytes } from "crypto";
import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";

type ActionResult = { error: string } | { success: true };
type InviteResult = { error: string } | { success: true; temporaryPassword: string };

export async function updateBranding(input: {
  name: string;
  email?: string;
  motto?: string;
  logo_url?: string;
  primary_color?: string;
}): Promise<ActionResult> {
  const supabase = await createClient();
  const { data: schoolId, error: schoolIdError } = await supabase.rpc("auth_school_id");
  if (schoolIdError || !schoolId) return { error: "Could not resolve your school." };

  const { error } = await supabase
    .from("schools")
    .update({
      name: input.name,
      email: input.email || null,
      motto: input.motto || null,
      logo_url: input.logo_url || null,
      primary_color: input.primary_color || null,
    })
    .eq("id", schoolId);
  if (error) return { error: error.message };

  revalidatePath("/settings");
  return { success: true };
}

function generateTemporaryPassword() {
  // Readable-ish but random — this is shown once to an admin to relay to
  // the new staff member manually (no email/SMS invite infra exists yet),
  // not something a user ever sees generated for themselves.
  return randomBytes(9).toString("base64url");
}

export async function inviteStaffMember(input: {
  full_name: string;
  email: string;
  role_id: string;
}): Promise<InviteResult> {
  const supabase = await createClient();
  const { data: schoolId, error: schoolIdError } = await supabase.rpc("auth_school_id");
  if (schoolIdError || !schoolId) return { error: "Could not resolve your school." };

  // Belt-and-braces: the school_users insert policy already requires
  // staff.manage, but check here too so we give a clean error instead of
  // creating an orphaned auth user if the RLS insert then fails.
  const { data: canManage } = await supabase.rpc("auth_has_permission", { p_permission_key: "staff.manage" });
  if (!canManage) return { error: "You don't have permission to add staff." };

  const temporaryPassword = generateTemporaryPassword();

  let adminClient;
  try {
    adminClient = createAdminClient();
  } catch (e) {
    return { error: e instanceof Error ? e.message : "Admin client is not configured." };
  }

  const { data: created, error: createError } = await adminClient.auth.admin.createUser({
    email: input.email,
    password: temporaryPassword,
    email_confirm: true,
  });
  if (createError || !created.user) {
    return { error: createError?.message ?? "Could not create the staff account." };
  }

  const { error: linkError } = await supabase.from("school_users").insert({
    auth_user_id: created.user.id,
    school_id: schoolId,
    role_id: input.role_id,
    full_name: input.full_name,
    email: input.email,
    status: "active",
  });
  if (linkError) {
    // Roll back the orphaned auth user rather than leaving a login with
    // no school_users row (which would be locked out anyway by RLS, but
    // it's still cleaner not to leave it dangling).
    await adminClient.auth.admin.deleteUser(created.user.id);
    return { error: linkError.message };
  }

  revalidatePath("/settings");
  return { success: true, temporaryPassword };
}

export async function changeStaffRole(schoolUserId: string, roleId: string): Promise<ActionResult> {
  const supabase = await createClient();
  const { error } = await supabase.from("school_users").update({ role_id: roleId }).eq("id", schoolUserId);
  if (error) return { error: error.message };
  revalidatePath("/settings");
  return { success: true };
}

export async function setStaffStatus(
  schoolUserId: string,
  status: "active" | "inactive" | "suspended",
): Promise<ActionResult> {
  const supabase = await createClient();
  const { error } = await supabase.from("school_users").update({ status }).eq("id", schoolUserId);
  if (error) return { error: error.message };
  revalidatePath("/settings");
  return { success: true };
}

// School-scoped API keys (Phase 5 Item 3). issue_api_key() itself re-checks api.manage and
// school scope server-side — the RPC is the actual gate, this is just a clean error path.
type IssueApiKeyResult = { error: string } | { success: true; raw_key: string; key_prefix: string };

export async function issueSchoolApiKey(input: {
  name: string;
  scopes: string[];
}): Promise<IssueApiKeyResult> {
  const supabase = await createClient();
  const { data: schoolId, error: schoolIdError } = await supabase.rpc("auth_school_id");
  if (schoolIdError || !schoolId) return { error: "Could not resolve your school." };

  const { data, error } = await supabase
    .rpc("issue_api_key", {
      p_name: input.name,
      p_scopes: input.scopes,
      p_school_id: schoolId,
      p_school_group_id: null,
      p_expires_at: null,
    })
    .single();

  if (error || !data) return { error: error?.message ?? "Could not create the API key." };
  const issued = data as { id: string; raw_key: string; key_prefix: string };

  revalidatePath("/settings");
  return { success: true, raw_key: issued.raw_key, key_prefix: issued.key_prefix };
}

export async function revokeSchoolApiKey(id: string): Promise<ActionResult> {
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
  revalidatePath("/settings");
  return { success: true };
}
