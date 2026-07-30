"use server";

import { randomBytes } from "crypto";
import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";

type ActionResult = { error: string } | { success: true };
type InviteResult = { error: string } | { success: true; temporaryPassword: string };

export async function updateBranding(input: {
  name: string;
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
