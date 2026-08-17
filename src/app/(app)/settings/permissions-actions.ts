"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { ALL_PERMISSION_KEYS } from "@/lib/permissions-catalog";

type ActionResult = { error: string } | { success: true };

export type PermissionSource = "user_override" | "role_override" | "role_default" | "none";

export interface EffectivePermission {
  key: string;
  allowed: boolean;
  source: PermissionSource;
  // true only when a user_permission_overrides row exists for this key —
  // the UI uses this to offer "reset to role default".
  isUserOverride: boolean;
}

/**
 * Returns, for one staff member, the effective allowed/denied state of every
 * known permission key and where it comes from (their own override, their
 * role's school-specific override, or the platform default for their role).
 * Mirrors the precedence implemented in auth_has_permission() in Postgres —
 * this is a read-side projection for the UI, not a second source of truth;
 * enforcement always happens in the database.
 */
export async function getEffectivePermissionsForUser(schoolUserId: string): Promise<
  { error: string } | { success: true; permissions: EffectivePermission[]; roleName: string }
> {
  const supabase = await createClient();

  const { data: targetUser, error: targetError } = await supabase
    .from("school_users")
    .select("id, role_id, school_id, roles(display_name)")
    .eq("id", schoolUserId)
    .maybeSingle();
  if (targetError || !targetUser) return { error: "Could not find that staff member." };

  const roleName = (targetUser.roles as unknown as { display_name: string } | null)?.display_name ?? "—";

  const [{ data: roleDefaults }, { data: roleOverrides }, { data: userOverrides }] = await Promise.all([
    supabase.from("role_permissions").select("permission_key, allowed").eq("role_id", targetUser.role_id).is("school_id", null),
    supabase
      .from("role_permissions")
      .select("permission_key, allowed")
      .eq("role_id", targetUser.role_id)
      .eq("school_id", targetUser.school_id),
    supabase.from("user_permission_overrides").select("permission_key, allowed").eq("school_user_id", schoolUserId),
  ]);

  const defaultMap = new Map((roleDefaults ?? []).map((r) => [r.permission_key, r.allowed]));
  const roleOverrideMap = new Map((roleOverrides ?? []).map((r) => [r.permission_key, r.allowed]));
  const userOverrideMap = new Map((userOverrides ?? []).map((r) => [r.permission_key, r.allowed]));

  const permissions: EffectivePermission[] = ALL_PERMISSION_KEYS.map((key) => {
    if (userOverrideMap.has(key)) {
      return { key, allowed: userOverrideMap.get(key)!, source: "user_override", isUserOverride: true };
    }
    if (roleOverrideMap.has(key)) {
      return { key, allowed: roleOverrideMap.get(key)!, source: "role_override", isUserOverride: false };
    }
    if (defaultMap.has(key)) {
      return { key, allowed: defaultMap.get(key)!, source: "role_default", isUserOverride: false };
    }
    return { key, allowed: false, source: "none", isUserOverride: false };
  });

  return { success: true, permissions, roleName };
}

/**
 * Grant or deny one specific permission for one specific staff member,
 * regardless of their role's defaults. RLS on user_permission_overrides
 * additionally requires the caller to hold settings.roles.manage AND
 * (when granting, not revoking) to already hold that exact permission
 * themselves -- so this action can fail even if the caller passes the
 * settings.roles.manage check, and that failure is expected/safe.
 */
export async function setUserPermissionOverride(
  schoolUserId: string,
  permissionKey: string,
  allowed: boolean,
): Promise<ActionResult> {
  const supabase = await createClient();

  const { data: targetUser, error: targetError } = await supabase
    .from("school_users")
    .select("school_id")
    .eq("id", schoolUserId)
    .maybeSingle();
  if (targetError || !targetUser) return { error: "Could not find that staff member." };

  const { error } = await supabase.from("user_permission_overrides").upsert(
    {
      school_id: targetUser.school_id,
      school_user_id: schoolUserId,
      permission_key: permissionKey,
      allowed,
    },
    { onConflict: "school_user_id,permission_key" },
  );
  if (error) {
    // The RLS "can't grant what you don't hold" check surfaces as a plain
    // RLS-denied error from Postgres -- give a clearer message for that case.
    if (error.code === "42501" || /row-level security/i.test(error.message)) {
      return {
        error: allowed
          ? "You can't grant a permission you don't hold yourself."
          : "You don't have permission to manage staff permissions.",
      };
    }
    return { error: error.message };
  }

  revalidatePath("/settings", "layout");
  return { success: true };
}

/** Remove a per-user override so the staff member reverts to their role's default/override. */
export async function clearUserPermissionOverride(schoolUserId: string, permissionKey: string): Promise<ActionResult> {
  const supabase = await createClient();
  const { error } = await supabase
    .from("user_permission_overrides")
    .delete()
    .eq("school_user_id", schoolUserId)
    .eq("permission_key", permissionKey);
  if (error) return { error: error.message };

  revalidatePath("/settings", "layout");
  return { success: true };
}
