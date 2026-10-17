import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { safeNextPath } from "@/lib/auth/safe-next-path";
import {
  friendlyLinkError,
  isAllowedTokenHashType,
  LINK_VERIFY_FAILED_MESSAGE,
} from "@/lib/auth/reset-link";

// Landing point for the SD-05 password-recovery email link. Supports two shapes:
//
// 1. `token_hash` + `type=recovery` (PRIMARY, Supabase's documented SSR pattern). The email
//    template links straight here, so the token is only consumed by the verifyOtp call below.
//    It does not depend on the project's Redirect URLs allowlist, does not need the PKCE
//    code_verifier cookie (so it works when the link is opened in a different browser or
//    device), and a mail scanner / link-preview GET cannot burn it (that was the second failure
//    mode behind "link is invalid or has expired").
// 2. `code` (LEGACY PKCE). Kept so reset emails already sent with the old template still work.
//
// Required Supabase dashboard setting for shape 1: Authentication -> Emails -> Reset Password
// template must link to
//   {{ .SiteURL }}/auth/confirm?token_hash={{ .TokenHash }}&type=recovery&next=/reset-password
export async function GET(request: NextRequest) {
  const { searchParams, origin } = new URL(request.url);
  const tokenHash = searchParams.get("token_hash");
  const type = searchParams.get("type");
  const code = searchParams.get("code");
  // `next` is attacker-controllable (it's a query param on an emailed link),
  // so only ever redirect to a same-app path -- see safe-next-path.ts.
  const next = safeNextPath(searchParams.get("next"));

  // Supabase can also send the visitor here with an error (e.g. otp_expired) instead of a token.
  const errorCode = searchParams.get("error_code");
  if (errorCode) {
    return NextResponse.redirect(
      `${origin}/login?error=${encodeURIComponent(friendlyLinkError(errorCode))}`,
    );
  }

  if (tokenHash && isAllowedTokenHashType(type)) {
    const supabase = await createClient();
    const { error } = await supabase.auth.verifyOtp({ type, token_hash: tokenHash });
    if (!error) {
      return NextResponse.redirect(`${origin}${next}`);
    }
  } else if (code) {
    const supabase = await createClient();
    const { error } = await supabase.auth.exchangeCodeForSession(code);
    if (!error) {
      return NextResponse.redirect(`${origin}${next}`);
    }
  }

  return NextResponse.redirect(
    `${origin}/login?error=${encodeURIComponent(LINK_VERIFY_FAILED_MESSAGE)}`,
  );
}
