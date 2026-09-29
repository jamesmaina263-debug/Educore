"use server";

import { cookies } from "next/headers";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { extractEdgeFunctionError } from "@/lib/edge-function-error";
import {
  ADMIN_OPERATOR_EMAILS,
  ADMIN_OPERATOR_OTP_PURPOSE,
  isAdminOperator,
  safeAdminNextPath,
  type AdminOperator,
} from "@/lib/admin-operator";
import { setAdminOperatorCookie } from "@/lib/admin-operator-server";

type ActionResult = { error: string } | { success: true };
type ConfirmResult = { error: string } | { success: true; next: string };

// Confirms a real super-admin session is behind this request before anything below sends or
// checks a code. Mirrors the check already in page.tsx / actions.ts -- kept separate (not
// imported from there) since this file has no dependency on the page rendering.
async function requireSuperAdminSession() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return null;

  const { data: isSuperAdmin } = await supabase.rpc("auth_is_super_admin");
  if (isSuperAdmin !== true) return null;

  return supabase;
}

// Step 1: send a 6-digit code to the fixed work email for the picked name. Reuses the same
// generate_otp + rate-limiting + delivery path as parent login (supabase/functions/request-otp)
// with a distinct purpose, so its 60s/10-per-day-per-address and 20/hr-per-IP caps apply here
// unchanged -- nothing new to build or tune for abuse resistance.
export async function requestOperatorCode(operator: AdminOperator): Promise<ActionResult> {
  if (!isAdminOperator(operator)) return { error: "Unrecognized person." };

  const supabase = await requireSuperAdminSession();
  if (!supabase) return { error: "Your session has expired. Please sign in again." };

  const { error } = await supabase.functions.invoke("request-otp", {
    body: {
      identifier: ADMIN_OPERATOR_EMAILS[operator],
      channel: "email",
      purpose: ADMIN_OPERATOR_OTP_PURPOSE,
    },
  });

  // request-otp's real error body (e.g. the 60s cooldown, or the 10/day cap) sits on
  // error.context, not error.message -- see edge-function-error.ts for why.
  if (error) {
    return { error: await extractEdgeFunctionError(error, "Could not send the code. Try again shortly.") };
  }

  return { success: true };
}

// Step 2: check the code and, only if it matches, set the same operator cookie the plain
// name-picker used to set directly. Calls verify_otp itself (via the service-role client -- see
// lib/supabase/admin.ts) rather than supabase/functions/verify-otp, because that edge function
// also creates/links a school_users login session, which has no meaning for a platform admin and
// would either fail or do the wrong thing here.
export async function confirmOperatorCode(
  operator: AdminOperator,
  code: string,
  next: string,
): Promise<ConfirmResult> {
  if (!isAdminOperator(operator)) return { error: "Unrecognized person." };
  if (!/^\d{6}$/.test(code)) return { error: "Enter the 6-digit code." };

  const supabase = await requireSuperAdminSession();
  if (!supabase) return { error: "Your session has expired. Please sign in again." };

  const admin = createAdminClient();
  const { data: isValid, error } = await admin.rpc("verify_otp", {
    p_phone: ADMIN_OPERATOR_EMAILS[operator],
    p_code: code,
    p_purpose: ADMIN_OPERATOR_OTP_PURPOSE,
    p_channel: "email",
  });

  if (error) {
    console.error("verify_otp (platform_admin_operator) failed", error);
    return { error: "Could not verify the code. Try again." };
  }
  if (!isValid) return { error: "Invalid or expired code." };

  setAdminOperatorCookie(await cookies(), operator);
  // Re-sanitized here (page.tsx already ran the raw searchParam through safeAdminNextPath before
  // handing it to the client component) so the redirect target this action hands back is never
  // dependent on trusting the client round-trip.
  return { success: true, next: safeAdminNextPath(next) };
}
