import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";

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
  const next = searchParams.get("next") ?? "/dashboard";

  if (code) {
    const supabase = await createClient();
    const { error } = await supabase.auth.exchangeCodeForSession(code);
    if (!error) {
      return NextResponse.redirect(`${origin}${next}`);
    }
  }

  return NextResponse.redirect(
    `${origin}/login?error=${encodeURIComponent(
      "That link has expired or was already used. Request a new one.",
    )}`,
  );
}
