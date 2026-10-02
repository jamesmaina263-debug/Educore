import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";

export const dynamic = "force-dynamic";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// RFC 8058 one-click unsubscribe: mail clients POST here (the List-Unsubscribe header points at
// this URL). POST only -- a GET must never unsubscribe anyone, because mail scanners prefetch
// links. The human-facing confirm page lives at /unsubscribe/[token].
export async function POST(_request: Request, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  if (!UUID_RE.test(token)) return NextResponse.json({ error: "Invalid link." }, { status: 400 });

  const admin = createAdminClient();
  const { error } = await admin.rpc("unsubscribe_marketing_email", { p_token: token });
  if (error) return NextResponse.json({ error: "Could not process the request." }, { status: 500 });

  // Same response whether or not the token matched, so tokens can't be probed.
  return NextResponse.json({ ok: true });
}
