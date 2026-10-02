import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { safeNextPath } from "@/lib/auth/safe-next-path";

// Generic landing point for Supabase Auth email links that need a
// server-side code exchange before a session exists -- currently just
// the SD-05 password-recovery link (resetPasswordForEmail in
// forgot-password/actions.ts), but written to handle any `code` param
// Supabase Auth hands back (PKCE flow, the @supabase/ssr default), not
// hard-coded to the recovery case specifically.
//
// Operational note: this route's full URL (`<app origin>/auth/confirm`)
// must be added to Authentication -> URL Configuration -> Redirect URLs
// in the Supabase dashboard for this project, or Supabase Auth will
// reject the redirect and the email link will dead-end on an error page
// instead of landing here. No tool in this environment can read or set
// that allowlist -- it's a one-time manual step for whoever has
// dashboard access.
export async function GET(request: NextRequest) {
  const { searchParams, origin } = new URL(request.url);
  const code = searchParams.get("code");
  // `next` is attacker-controllable (it's a query param on an emailed link),
  // so only ever redirect to a same-app path -- see safe-next-path.ts.
  const next = safeNextPath(searchParams.get("next"));

  if (code) {
    const supabase = await createClient();
    const { error } = await supabase.auth.exchangeCodeForSession(code);
    if (!error) {
      return NextResponse.redirect(`${origin}${next}`);
    }
  }

  return NextResponse.redirect(
    `${origin}/login?error=${encodeURIComponent(
      "Couldn't verify this link. If you requested this on a different device or browser, open it on the original one, or request a new link.",
    )}`,
  );
}
