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
//    template links straight here. The token is single-use and is consumed by verifyOtp.
//    It does not depend on the project's Redirect URLs allowlist and does not need the PKCE
//    code_verifier cookie (so it works when the link is opened in a different browser/device).
//
//    IMPORTANT: verifyOtp must NEVER run on a GET. Mail scanners (Gmail/Outlook safe-links),
//    browser/OS link prefetch and chat-app link previews all issue GETs to emailed URLs. If a GET
//    consumed the token, the first automated hit would burn it and the real person would land
//    on "Couldn't verify this link" (Supabase error_code otp_expired -- confirmed in the auth
//    logs: two POST /verify calls ~1s apart, the first 200, the second 403 "One-time token not
//    found"). So GET only renders a "Continue" page, and the token is consumed by the POST that
//    the person's click submits. Scanners do not submit forms.
// 2. `code` (LEGACY PKCE). Kept so reset emails already sent with the old template still work.
//    A scanner has no code_verifier cookie, so its exchange fails without ever succeeding.
//
// Required Supabase dashboard setting for shape 1: Authentication -> Emails -> Reset Password
// template must link to
//   {{ .SiteURL }}/auth/confirm?token_hash={{ .TokenHash }}&type=recovery&next=/reset-password

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function confirmPage(tokenHash: string, type: string, next: string): NextResponse {
  const html = `<!doctype html>
<html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex,nofollow">
<title>Reset your password</title>
<style>
body{font-family:system-ui,sans-serif;background:#f8f8f8;margin:0;display:flex;min-height:100vh;align-items:center;justify-content:center}
main{background:#fff;border:1px solid #e5e7eb;border-radius:16px;padding:32px;max-width:420px;width:calc(100% - 32px);text-align:center}
h1{font-size:22px;margin:0 0 8px}p{color:#6b7280;margin:0 0 24px}
button{background:#e0a92b;border:0;border-radius:8px;padding:12px 20px;font-size:16px;font-weight:600;width:100%;cursor:pointer}
</style></head><body><main>
<h1>Reset your password</h1>
<p>Tap the button below to continue and choose a new password.</p>
<form method="POST" action="/auth/confirm">
<input type="hidden" name="token_hash" value="${escapeHtml(tokenHash)}">
<input type="hidden" name="type" value="${escapeHtml(type)}">
<input type="hidden" name="next" value="${escapeHtml(next)}">
<button type="submit">Continue</button>
</form></main></body></html>`;
  return new NextResponse(html, {
    status: 200,
    headers: {
      "Content-Type": "text/html; charset=utf-8",
      "Cache-Control": "no-store",
      "Referrer-Policy": "no-referrer",
    },
  });
}

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

  // Primary flow: do NOT consume the token on GET -- render the confirm page (see header).
  if (tokenHash && isAllowedTokenHashType(type)) {
    return confirmPage(tokenHash, type, next);
  }

  // Legacy PKCE flow.
  if (code) {
    const supabase = await createClient();
    const { error } = await supabase.auth.exchangeCodeForSession(code);
    if (!error) {
      return NextResponse.redirect(`${origin}${next}`);
    }
    console.error("auth/confirm: code exchange failed", error.code ?? error.status);
  }

  return NextResponse.redirect(
    `${origin}/login?error=${encodeURIComponent(LINK_VERIFY_FAILED_MESSAGE)}`,
  );
}

// The person's click on "Continue" lands here and consumes the single-use token.
export async function POST(request: NextRequest) {
  const { origin } = new URL(request.url);
  const form = await request.formData();
  const tokenHash = String(form.get("token_hash") ?? "");
  const type = String(form.get("type") ?? "");
  const next = safeNextPath(String(form.get("next") ?? ""));

  if (tokenHash && isAllowedTokenHashType(type)) {
    const supabase = await createClient();
    const { error } = await supabase.auth.verifyOtp({ type, token_hash: tokenHash });
    if (!error) {
      // 303 so the browser follows with a GET.
      return NextResponse.redirect(`${origin}${next}`, 303);
    }
    // Surface the real reason instead of swallowing it (this is what made the bug invisible).
    console.error("auth/confirm: verifyOtp failed", error.code ?? error.status);
    return NextResponse.redirect(
      `${origin}/login?error=${encodeURIComponent(friendlyLinkError(error.code))}`,
      303,
    );
  }

  return NextResponse.redirect(
    `${origin}/login?error=${encodeURIComponent(LINK_VERIFY_FAILED_MESSAGE)}`,
    303,
  );
}
