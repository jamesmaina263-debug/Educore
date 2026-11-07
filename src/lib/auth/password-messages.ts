// Plain-language messages for the forgot-password / reset-password / change-password flows.
// Kept pure (no next/headers, no Supabase client) so the wording and the error mapping can be
// unit-tested.
//
// Background (Oct 30 2026): customers reported not receiving the set-password / reset email and a
// reset that "did nothing". Two of the causes were in the app, not the mail provider:
//   * forgot-password ignored the result of resetPasswordForEmail, so it showed "check your email"
//     even when Supabase had refused to send (rate limit, SMTP failure).
//   * change-password bounced a visitor with no session to /login with no explanation, so a reset
//     opened in the wrong browser (or after the session was lost) looked like it silently failed.

export const SUPPORT_EMAIL = "support@educoreafrica.com";

export const EMAIL_SEND_FAILED_MESSAGE = `We couldn't send the email right now. Please wait a minute and try again, or contact ${SUPPORT_EMAIL}.`;

export const PASSWORD_SESSION_MISSING_MESSAGE =
  "Your session has expired, or the reset link was opened in a different browser. Sign in again, or request a new link with 'Forgot password' below.";

type AuthErrorLike = { code?: string | null; message?: string | null } | null | undefined;

// Maps the Supabase Auth errors people actually hit while setting a password to plain wording.
// Anything unrecognised keeps Supabase's own message, so no failure ever becomes silent or vague.
export function friendlyPasswordUpdateError(error: AuthErrorLike): string {
  switch (error?.code) {
    case "same_password":
      return "Your new password must be different from your current password.";
    case "weak_password":
      return "That password is too weak. Use a longer password that mixes letters and numbers.";
    case "session_not_found":
    case "session_expired":
      return PASSWORD_SESSION_MISSING_MESSAGE;
    case "over_request_rate_limit":
      return "Too many attempts. Please wait a minute and try again.";
    default:
      return error?.message || "We couldn't update your password. Please try again.";
  }
}
