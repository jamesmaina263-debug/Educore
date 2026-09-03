"use server";

import { headers } from "next/headers";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { getRealClientIp } from "@/lib/get-real-client-ip";
import { sendSecurityAlert } from "@/lib/security-alert";
import { SITE_URL } from "@/lib/site";

export type ForgotPasswordState = { error: string | null; sent: boolean };

// SD-05: self-serve password reset. Previously staff had no way to recover
// a forgotten password on their own -- see the comment on resetStaffPassword
// in settings/actions.ts -- an admin had to issue a fresh temporary password
// for every lockout, even a routine "I forgot it" case. This uses Supabase
// Auth's own resetPasswordForEmail rather than anything custom: it emails a
// one-time recovery link (via /auth/confirm) that lands the person on
// /reset-password with a real (short-lived) session already established.
//
// Deliberately always returns the same generic "sent" response regardless
// of whether the email actually matches an account -- same anti-enumeration
// principle as login's "Invalid email or password." Supabase's API itself
// doesn't leak existence either (it returns success either way), so this
// just makes sure our own UI doesn't undo that.
export async function requestPasswordReset(
  _prevState: ForgotPasswordState,
  formData: FormData,
): Promise<ForgotPasswordState> {
  const email = String(formData.get("email") ?? "").trim();
  if (!email) {
    return { error: "Enter your email address.", sent: false };
  }

  // Rate limiting: tighter than login's (20/hr IP, 10/hr email) because this
  // endpoint triggers a real outbound email through Supabase's shared SMTP
  // (rate-limited on their end too, and a soft-launch-scale project like
  // this one hasn't set up a custom SMTP provider yet -- see the note left
  // for James in the PR description). Without a limit here, someone could
  // both exhaust that shared quota and email-bomb an arbitrary address.
  const requestHeaders = await headers();
  const forwardedFor = requestHeaders.get("x-forwarded-for");
  const clientIp = getRealClientIp(forwardedFor);
  try {
    const adminClient = createAdminClient();
    const [{ data: withinIpLimit }, { data: withinEmailLimit }] = await Promise.all([
      adminClient.rpc("increment_and_check_rate_limit", {
        p_bucket: `password-reset-ip:${clientIp}`,
        p_max_events: 10,
        p_window_seconds: 3600,
      }),
      adminClient.rpc("increment_and_check_rate_limit", {
        p_bucket: `password-reset-email:${email.toLowerCase()}`,
        p_max_events: 3,
        p_window_seconds: 3600,
      }),
    ]);
    if (withinIpLimit === false || withinEmailLimit === false) {
      void sendSecurityAlert("Password reset rate limit tripped", {
        limit: withinIpLimit === false ? "per-IP (10/hr)" : "per-email (3/hr)",
        ip: clientIp,
        email_domain: email.toLowerCase().split("@").at(-1) ?? "unknown",
      });
      // Same generic response even when rate-limited -- confirming a limit
      // was hit would itself leak "this email is being actively targeted."
      return { error: null, sent: true };
    }
  } catch {
    // If the admin client isn't configured, fall through -- Supabase Auth's
    // own project-level rate limiting on this endpoint still applies.
  }

  const origin =
    requestHeaders.get("origin") ??
    (requestHeaders.get("host") ? `https://${requestHeaders.get("host")}` : null) ??
    SITE_URL;
  const supabase = await createClient();
  await supabase.auth.resetPasswordForEmail(email, {
    redirectTo: `${origin}/auth/confirm?next=/reset-password`,
  });

  return { error: null, sent: true };
}
