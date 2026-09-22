"use server";

import { headers } from "next/headers";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { tagSentryRequestContext } from "@/lib/observability/sentry-context";
import { getRealClientIp } from "@/lib/get-real-client-ip";
import { sendSecurityAlert } from "@/lib/security-alert";
import { isPasswordPwned } from "@/lib/password-breach-check";

export type ChangeOwnPasswordState = { error: string | null; success?: boolean };

// Voluntary, self-service password change for an already-signed-in user (any
// role -- school owner included). Distinct from src/app/change-password,
// which only handles the *forced* first-login/temp-password flow and isn't
// reachable from anywhere in the app once a user is already past that gate
// (see src/lib/supabase/middleware.ts) -- until this action, there was no
// way for someone to change their password on their own initiative.
export async function changeOwnPassword(
  _prevState: ChangeOwnPasswordState,
  formData: FormData,
): Promise<ChangeOwnPasswordState> {
  const currentPassword = String(formData.get("current_password") ?? "");
  const newPassword = String(formData.get("new_password") ?? "");
  const confirmPassword = String(formData.get("confirm_password") ?? "");

  if (!currentPassword) {
    return { error: "Enter your current password." };
  }
  if (newPassword.length < 8) {
    return { error: "New password must be at least 8 characters." };
  }
  if (newPassword !== confirmPassword) {
    return { error: "New passwords don't match." };
  }
  if (newPassword === currentPassword) {
    return { error: "New password must be different from your current password." };
  }

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user || !user.email) {
    return { error: "Your session has expired. Please sign in again." };
  }
  await tagSentryRequestContext(supabase);

  // Rate-limit re-auth attempts per user: without this, this form is a free
  // oracle for guessing someone's current password (unlimited tries, no
  // lockout, already-authenticated so it skips the login page's own IP/email
  // limits entirely). Same increment_and_check_rate_limit() primitive as
  // login/signup -- see login/actions.ts for the pattern this mirrors.
  const forwardedFor = (await headers()).get("x-forwarded-for");
  const clientIp = getRealClientIp(forwardedFor);
  try {
    const adminClient = createAdminClient();
    const { data: withinLimit } = await adminClient.rpc("increment_and_check_rate_limit", {
      p_bucket: `change-own-password:${user.id}`,
      p_max_events: 10,
      p_window_seconds: 3600,
    });
    if (withinLimit === false) {
      void sendSecurityAlert("Change-password rate limit tripped", {
        bucket: `change-own-password:${user.id}`,
        ip: clientIp,
      });
      return { error: "Too many attempts. Please wait a while and try again." };
    }
  } catch {
    // Same fail-open posture as login/actions.ts: an unconfigured admin
    // client shouldn't block a legitimate password change.
  }

  // Re-authenticate with the current password before allowing the change.
  // supabase.auth.updateUser() alone would let anyone with a live,
  // unattended session (shared computer, stolen cookie) silently take over
  // the account by setting a new password -- requiring the current one
  // closes that gap. A successful call here just refreshes the existing
  // session for the same user; it doesn't sign anyone out.
  const { error: reauthError } = await supabase.auth.signInWithPassword({
    email: user.email,
    password: currentPassword,
  });
  if (reauthError) {
    return { error: "Current password is incorrect." };
  }

  if (await isPasswordPwned(newPassword)) {
    return {
      error:
        "This password has appeared in a known data breach and isn't safe to use. Please choose a different password.",
    };
  }

  const { error: updateError } = await supabase.auth.updateUser({ password: newPassword });
  if (updateError) return { error: updateError.message };

  // Mirrors the cleanup in change-password/actions.ts -- harmless no-op if
  // these flags were already clear, but keeps behavior identical if someone
  // voluntarily changes their password while still under the forced-change
  // gate for some reason.
  try {
    const adminClient = createAdminClient();
    await adminClient
      .from("school_users")
      .update({
        must_change_password: false,
        temp_password_expires_at: null,
        password_changed_at: new Date().toISOString(),
      })
      .eq("auth_user_id", user.id);
  } catch {
    // Password itself is already changed (the important part); worst case
    // is a redundant prompt later, which is safe.
  }

  return { error: null, success: true };
}
