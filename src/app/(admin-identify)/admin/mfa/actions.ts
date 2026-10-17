"use server";

import { cookies } from "next/headers";
import { createClient } from "@/lib/supabase/server";
import { isAdminOperator, safeAdminNextPath, type AdminOperator } from "@/lib/admin-operator";
import { setAdminOperatorCookie } from "@/lib/admin-operator-server";
import { isSuperAdminAnyAal, isTotpCode } from "@/lib/admin-mfa";

type EnrollResult = { error: string } | { factorId: string; qrCode: string; secret: string };
type VerifyResult = { error: string } | { success: true; next: string };

const GENERIC_ERROR = "Could not complete that step. Try again.";

// Same gate as the rest of the admin console, minus the aal2 requirement (this is the page that
// gets you to aal2). Returns the user-scoped client, or null if this is not a platform admin.
async function requireAdminSessionAnyAal() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return null;
  if (!(await isSuperAdminAnyAal(supabase))) return null;
  return supabase;
}

// Step 1 of adding an authenticator. The factor's friendly name is the operator's name: that
// binding is what lets a verified code identify WHO is signing in, instead of the old
// self-declared name picker.
export async function startEnrollment(operator: AdminOperator): Promise<EnrollResult> {
  if (!isAdminOperator(operator)) return { error: "Unrecognized person." };
  const supabase = await requireAdminSessionAnyAal();
  if (!supabase) return { error: "Your session has expired. Please sign in again." };

  // Clear an abandoned, never-verified attempt for the same person so a retry works.
  const { data: existing } = await supabase.auth.mfa.listFactors();
  for (const factor of existing?.all ?? []) {
    if (factor.status === "unverified" && factor.friendly_name === operator) {
      await supabase.auth.mfa.unenroll({ factorId: factor.id });
    }
  }
  if ((existing?.all ?? []).some((f) => f.status === "verified" && f.friendly_name === operator)) {
    return { error: `${operator} already has an authenticator. Use it to verify.` };
  }

  const { data, error } = await supabase.auth.mfa.enroll({
    factorType: "totp",
    friendlyName: operator,
    issuer: "EduCore Admin",
  });
  if (error || !data) {
    console.error("admin mfa enroll failed", error?.message);
    return { error: GENERIC_ERROR };
  }
  return { factorId: data.id, qrCode: data.totp.qr_code, secret: data.totp.secret };
}

// Used both to finish enrollment and for every later sign-in: challenge the factor, check the
// code, and -- only on success -- record which operator this is from the factor's name.
export async function verifyTotp(factorId: string, code: string, next: string): Promise<VerifyResult> {
  if (typeof factorId !== "string" || factorId.length === 0) return { error: GENERIC_ERROR };
  if (!isTotpCode(code)) return { error: "Enter the 6-digit code." };

  const supabase = await requireAdminSessionAnyAal();
  if (!supabase) return { error: "Your session has expired. Please sign in again." };

  const { data: factors } = await supabase.auth.mfa.listFactors();
  const factor = (factors?.all ?? []).find((f) => f.id === factorId);
  if (!factor) return { error: GENERIC_ERROR };
  if (!isAdminOperator(factor.friendly_name)) {
    return { error: "This authenticator is not linked to a named operator. Ask the platform owner." };
  }

  const { data: challenge, error: challengeError } = await supabase.auth.mfa.challenge({ factorId });
  if (challengeError || !challenge) {
    console.error("admin mfa challenge failed", challengeError?.message);
    return { error: GENERIC_ERROR };
  }

  const { error: verifyError } = await supabase.auth.mfa.verify({
    factorId,
    challengeId: challenge.id,
    code,
  });
  if (verifyError) return { error: "Invalid or expired code." };

  setAdminOperatorCookie(await cookies(), factor.friendly_name);
  return { success: true, next: safeAdminNextPath(next) };
}
