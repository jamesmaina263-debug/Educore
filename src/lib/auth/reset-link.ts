import { SITE_URL } from "@/lib/site";

// Helpers for the password-recovery email link. Kept pure (no next/headers, no Supabase client)
// so the rules can be unit-tested.
//
// Background (Oct 12 incident): forgot-password built redirectTo from the request's Origin/Host
// header. When the form was submitted from the Vercel alias (educore-beige.vercel.app), Supabase
// received a redirect_to that is not on the project's Redirect URLs allowlist and -- by design --
// silently substituted the Site URL (https://www.educoreafrica.com) in the emailed link. The link
// then landed on the marketing home page instead of /auth/confirm.

// Production always uses the one canonical, allowlisted origin. Only non-production environments
// (local dev, Vercel previews) fall back to the request's own origin so those keep working.
export function resolveAuthRedirectOrigin(
  requestOrigin: string | null | undefined,
  vercelEnv: string | undefined = process.env.VERCEL_ENV,
  siteUrl: string = SITE_URL,
): string {
  const canonical = siteUrl.replace(/\/+$/, "");
  if (vercelEnv === "production") return canonical;
  if (!requestOrigin) return canonical;
  try {
    const parsed = new URL(requestOrigin);
    if (parsed.protocol !== "https:" && parsed.protocol !== "http:") return canonical;
    return parsed.origin;
  } catch {
    return canonical;
  }
}

// OTP types /auth/confirm will verify via token_hash. Recovery only: this route exists for the
// password-reset email, so it must not become a generic "verify any email OTP" endpoint.
export const ALLOWED_TOKEN_HASH_TYPES = ["recovery"] as const;
export type AllowedTokenHashType = (typeof ALLOWED_TOKEN_HASH_TYPES)[number];

export function isAllowedTokenHashType(value: string | null): value is AllowedTokenHashType {
  return value !== null && (ALLOWED_TOKEN_HASH_TYPES as readonly string[]).includes(value);
}

export const LINK_VERIFY_FAILED_MESSAGE =
  "Couldn't verify this link. It may have expired or already been used. Request a new one with 'Forgot password' on this page.";

export const LINK_EXPIRED_MESSAGE =
  "This password reset link has expired or was already used. Request a new one from the 'Forgot password' page.";

export function friendlyLinkError(errorCode: string | null | undefined): string {
  if (errorCode === "otp_expired") return LINK_EXPIRED_MESSAGE;
  return LINK_VERIFY_FAILED_MESSAGE;
}

// Safety net for links that still end up on the site root: Supabase appends either `?code=...`
// (PKCE success) or `?error=...&error_code=...` (failure) to the Site URL when redirect_to wasn't
// honoured. Returns the in-app path to send the visitor to instead, or null for ordinary traffic.
// Only ever matches "/" with those specific params, so it cannot affect any normal page.
// Recovery is the only flow in this app that issues PKCE codes (no OAuth, magic-link or email
// sign-up flows), so a stray code at "/" is a password-reset code.
export function rootAuthFallback(url: URL): string | null {
  if (url.pathname !== "/") return null;
  const params = url.searchParams;
  const code = params.get("code");
  if (code) {
    return `/auth/confirm?code=${encodeURIComponent(code)}&next=${encodeURIComponent("/reset-password")}`;
  }
  const errorCode = params.get("error_code");
  if (errorCode) {
    return `/login?error=${encodeURIComponent(friendlyLinkError(errorCode))}`;
  }
  return null;
}
