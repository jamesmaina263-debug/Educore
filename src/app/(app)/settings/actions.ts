"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { generateTemporaryPassword, temporaryPasswordExpiry } from "@/lib/temporary-password";

type ActionResult = { error: string } | { success: true };
type InviteResult = { error: string } | { success: true; temporaryPassword: string };

export async function updateBranding(input: {
  name: string;
  email?: string;
  motto?: string;
  logo_url?: string;
  primary_color?: string;
  kra_pin?: string;
  admission_response_note?: string;
}): Promise<ActionResult> {
  const supabase = await createClient();
  const { data: schoolId, error: schoolIdError } = await supabase.rpc("auth_school_id");
  if (schoolIdError || !schoolId) return { error: "Could not resolve your school." };

  // admission_response_note is only ever set from GeneralSettingsPanel below, not from
  // BrandingForm (a separate caller of this same action, which doesn't know this field
  // exists). Unlike the other fields here, this one is conditionally included -- `undefined`
  // means "caller didn't touch it," leaving the existing value alone, rather than always
  // coercing to null and letting a Branding-only save silently wipe it out.
  const update: Record<string, string | null> = {
    name: input.name,
    email: input.email || null,
    motto: input.motto || null,
    logo_url: input.logo_url || null,
    primary_color: input.primary_color || null,
    kra_pin: input.kra_pin || null,
  };
  if (input.admission_response_note !== undefined) {
    update.admission_response_note = input.admission_response_note || null;
  }

  const { error } = await supabase.from("schools").update(update).eq("id", schoolId);
  if (error) return { error: error.message };

  revalidatePath("/settings", "layout");
  return { success: true };
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
    must_change_password: true,
    temp_password_expires_at: temporaryPasswordExpiry(),
  });
  if (linkError) {
    // Roll back the orphaned auth user rather than leaving a login with
    // no school_users row (which would be locked out anyway by RLS, but
    // it's still cleaner not to leave it dangling).
    await adminClient.auth.admin.deleteUser(created.user.id);
    return { error: linkError.message };
  }

  revalidatePath("/settings", "layout");
  return { success: true, temporaryPassword };
}

export async function changeStaffRole(schoolUserId: string, roleId: string): Promise<ActionResult> {
  const supabase = await createClient();
  const { error } = await supabase.from("school_users").update({ role_id: roleId }).eq("id", schoolUserId);
  if (error) return { error: error.message };
  revalidatePath("/settings", "layout");
  return { success: true };
}

export async function setStaffStatus(
  schoolUserId: string,
  status: "active" | "inactive" | "suspended",
): Promise<ActionResult> {
  const supabase = await createClient();

  const { data: target, error: fetchError } = await supabase
    .from("school_users")
    .select("auth_user_id")
    .eq("id", schoolUserId)
    .maybeSingle();
  if (fetchError) return { error: fetchError.message };
  if (!target) return { error: "Staff member not found." };

  const { error } = await supabase.from("school_users").update({ status }).eq("id", schoolUserId);
  if (error) return { error: error.message };

  // Auth is one shared account across every school this person belongs to
  // -- school_users.status alone only gates this one row, so someone
  // deactivated here could previously still sign back in through a
  // different, still-active membership at another school. Ban/unban the
  // underlying Supabase Auth user directly so a status change here takes
  // effect everywhere, immediately. Deliberate tradeoff (Lucy's explicit
  // choice, 2026-08-21): reactivating here unbans globally too, even for a
  // school that never touched this person's status -- not "locked out only
  // once every membership is inactive."
  try {
    const adminClient = createAdminClient();
    const { error: banError } = await adminClient.auth.admin.updateUserById(target.auth_user_id, {
      // "none" clears a ban; there's no true "forever" value, so ~100 years
      // stands in for permanent until someone explicitly reactivates.
      ban_duration: status === "active" ? "none" : "876000h",
    });
    if (banError) throw banError;
  } catch (err) {
    // The school_users.status change (and the RLS it drives for this one
    // school) already took effect -- don't roll that back. But don't report
    // clean success either, since a failed ban sync silently defeats the
    // whole point of this change.
    console.error("Failed to sync auth ban state for", target.auth_user_id, err);
    return {
      error:
        status === "active"
          ? "Status updated, but failed to restore account-wide login access. Check server logs."
          : "Status updated, but failed to lock account-wide login access. Check server logs.",
    };
  }

  revalidatePath("/settings", "layout");
  return { success: true };
}

// Issues a fresh temporary password for a staff member who is locked out
// (temp password expired, or they've simply forgotten it — there's no
// self-serve "forgot password" flow yet since staff never had a real email
// inbox this app can rely on). Re-arms must_change_password so the new
// temp password is subject to the same forced-change + expiry rules as a
// first-time invite.
export async function resetStaffPassword(schoolUserId: string): Promise<InviteResult> {
  const supabase = await createClient();
  const { data: schoolId, error: schoolIdError } = await supabase.rpc("auth_school_id");
  if (schoolIdError || !schoolId) return { error: "Could not resolve your school." };

  const { data: canManage } = await supabase.rpc("auth_has_permission", { p_permission_key: "staff.manage" });
  if (!canManage) return { error: "You don't have permission to reset staff passwords." };

  // Scope the lookup to our own school explicitly — schoolUserId is
  // client-supplied, and RLS on the select below (school_id = auth_school_id())
  // already enforces this, but resolving school_id here too keeps the
  // school_id filter and the auth_user_id lookup as one traceable step.
  const { data: target, error: targetError } = await supabase
    .from("school_users")
    .select("auth_user_id, school_id")
    .eq("id", schoolUserId)
    .maybeSingle();
  if (targetError || !target) return { error: "Staff member not found." };
  if (target.school_id !== schoolId) return { error: "Staff member not found." };

  const temporaryPassword = generateTemporaryPassword();

  let adminClient;
  try {
    adminClient = createAdminClient();
  } catch (e) {
    return { error: e instanceof Error ? e.message : "Admin client is not configured." };
  }

  const { error: updatePasswordError } = await adminClient.auth.admin.updateUserById(
    target.auth_user_id,
    { password: temporaryPassword },
  );
  if (updatePasswordError) return { error: updatePasswordError.message };

  // Service-role write: auth.uid() is null here, so the escalation-guard
  // trigger on school_users treats it as trusted (see the migration that
  // introduced these columns) — a non-admin user could not do this to
  // their own row via the regular client.
  const { error: flagError } = await adminClient
    .from("school_users")
    .update({
      must_change_password: true,
      temp_password_expires_at: temporaryPasswordExpiry(),
    })
    .eq("id", schoolUserId);
  if (flagError) return { error: flagError.message };

  revalidatePath("/settings", "layout");
  return { success: true, temporaryPassword };
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

  revalidatePath("/settings", "layout");
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
  revalidatePath("/settings", "layout");
  return { success: true };
}

// Biometric devices. issue_biometric_device_key() re-checks biometric.devices_manage
// and school scope server-side, same shape as issue_api_key() above -- the RPC is
// the actual gate, this is just a clean error path.
type RegisterBiometricDeviceResult = { error: string } | { success: true; raw_key: string; key_prefix: string };

export async function registerBiometricDevice(input: {
  name: string;
  device_type: string;
  provider: string;
  location: string;
  serial_number: string;
}): Promise<RegisterBiometricDeviceResult> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .rpc("issue_biometric_device_key", {
      p_name: input.name,
      p_device_type: input.device_type,
      p_provider: input.provider,
      p_location: input.location || null,
      p_serial_number: input.serial_number || null,
    })
    .single();

  if (error || !data) return { error: error?.message ?? "Could not register the device." };
  const issued = data as { id: string; raw_key: string; key_prefix: string };

  revalidatePath("/settings", "layout");
  return { success: true, raw_key: issued.raw_key, key_prefix: issued.key_prefix };
}

export async function setBiometricDeviceStatus(id: string, status: "active" | "inactive"): Promise<ActionResult> {
  const supabase = await createClient();
  const { error } = await supabase.from("biometric_devices").update({ status }).eq("id", id);
  if (error) return { error: error.message };
  revalidatePath("/settings", "layout");
  return { success: true };
}

// Gate lateness thresholds. update_gate_late_thresholds() re-checks
// biometric.devices_manage and school scope server-side (same shape as
// issue_biometric_device_key above) rather than a direct RLS-gated update
// on `schools`, whose blanket UPDATE policy is gated on
// settings.branding.write -- the wrong permission for this setting.
export async function updateGateLateThresholds(input: {
  late_after_student: string | null; // "HH:MM" from a <input type="time">, or null to clear
  late_after_staff: string | null;
}): Promise<ActionResult> {
  const supabase = await createClient();
  const { error } = await supabase.rpc("update_gate_late_thresholds", {
    p_late_after_student: input.late_after_student || null,
    p_late_after_staff: input.late_after_staff || null,
  });
  if (error) return { error: error.message };
  revalidatePath("/settings", "layout");
  return { success: true };
}

// Leave Types (Settings > Leave Types). leave_types is school-scoped and RLS-gated on
// staff.manage for writes — see the phase3 staff-directory migration and the
// seed_default_leave_types migration for why every school starts with a default set.
export async function createLeaveType(input: {
  name: string;
  days_per_year: number;
  restricted_gender?: "male" | "female" | null;
}): Promise<ActionResult> {
  const name = input.name.trim();
  if (!name) return { error: "Name is required." };
  if (!Number.isFinite(input.days_per_year) || input.days_per_year < 0) {
    return { error: "Days per year must be a non-negative number." };
  }

  const supabase = await createClient();
  const { data: schoolId, error: schoolIdError } = await supabase.rpc("auth_school_id");
  if (schoolIdError || !schoolId) return { error: "Could not resolve your school." };

  const { error } = await supabase.from("leave_types").insert({
    school_id: schoolId,
    name,
    days_per_year: input.days_per_year,
    restricted_gender: input.restricted_gender ?? null,
  });
  if (error) {
    if (error.code === "23505") return { error: "A leave type with that name already exists." };
    return { error: error.message };
  }
  revalidatePath("/settings", "layout");
  revalidatePath("/staff", "layout");
  return { success: true };
}

export async function updateLeaveType(
  id: string,
  input: { name: string; days_per_year: number; restricted_gender?: "male" | "female" | null },
): Promise<ActionResult> {
  const name = input.name.trim();
  if (!name) return { error: "Name is required." };
  if (!Number.isFinite(input.days_per_year) || input.days_per_year < 0) {
    return { error: "Days per year must be a non-negative number." };
  }

  const supabase = await createClient();
  const { error } = await supabase
    .from("leave_types")
    .update({ name, days_per_year: input.days_per_year, restricted_gender: input.restricted_gender ?? null })
    .eq("id", id);
  if (error) {
    if (error.code === "23505") return { error: "A leave type with that name already exists." };
    return { error: error.message };
  }
  revalidatePath("/settings", "layout");
  revalidatePath("/staff", "layout");
  return { success: true };
}

export async function deleteLeaveType(id: string): Promise<ActionResult> {
  const supabase = await createClient();
  const { error } = await supabase.from("leave_types").delete().eq("id", id);
  if (error) {
    // leave_requests.leave_type_id has no ON DELETE clause (default RESTRICT) — a type
    // that's ever been used on a request can't be dropped, only renamed/edited.
    if (error.code === "23503") {
      return { error: "This leave type has requests recorded against it and can't be deleted. You can rename it instead." };
    }
    return { error: error.message };
  }
  revalidatePath("/settings", "layout");
  revalidatePath("/staff", "layout");
  return { success: true };
}
