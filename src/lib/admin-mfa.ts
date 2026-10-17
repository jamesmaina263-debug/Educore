import type { SupabaseClient } from "@supabase/supabase-js";

// Platform-admin MFA (security audit finding H1).
//
// Enforcement itself lives in the database: once public.set_admin_mfa_required(true) has been
// run, auth_is_super_admin() returns false for any session that has not verified a TOTP code
// (aal2). Everything here is the UX around that -- deciding where to send someone -- and is safe
// to deploy before the migration is applied: every RPC call below falls back to the previous
// behaviour if the new function does not exist yet.

export type AdminMfaState = {
  // True once the operator has switched enforcement on in the database.
  required: boolean;
  // Assurance level of the current session. null if it could not be determined.
  currentLevel: "aal1" | "aal2" | null;
};

// "Is this account a platform super-admin at all, regardless of MFA?" Used to decide whether to
// show the MFA page. Falls back to auth_is_super_admin() when the new RPC is not deployed yet
// (before enforcement is on the two are identical).
export async function isSuperAdminAnyAal(supabase: SupabaseClient): Promise<boolean> {
  const { data, error } = await supabase.rpc("auth_is_super_admin_any_aal");
  if (!error) return data === true;
  const { data: legacy } = await supabase.rpc("auth_is_super_admin");
  return legacy === true;
}

export async function getAdminMfaState(supabase: SupabaseClient): Promise<AdminMfaState> {
  let required = false;
  const { data: requiredData, error: requiredError } = await supabase.rpc("admin_mfa_required");
  if (!requiredError) required = requiredData === true;

  let currentLevel: AdminMfaState["currentLevel"] = null;
  try {
    const { data } = await supabase.auth.mfa.getAuthenticatorAssuranceLevel();
    currentLevel = data?.currentLevel === "aal2" ? "aal2" : data?.currentLevel === "aal1" ? "aal1" : null;
  } catch {
    currentLevel = null;
  }

  return { required, currentLevel };
}

// 6-digit authenticator code.
export function isTotpCode(value: unknown): value is string {
  return typeof value === "string" && /^\d{6}$/.test(value);
}
