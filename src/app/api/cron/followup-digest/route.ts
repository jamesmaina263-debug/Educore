import { NextResponse } from "next/server";
import { isValidCronRequest } from "@/lib/cron-auth";
import { sendSecurityAlert } from "@/lib/security-alert";

export const dynamic = "force-dynamic";
export const maxDuration = 30;

// Daily trigger (08:00 Kenya time) for the sales follow-up email. Everything real happens in the
// send-followup-digest Edge Function: it reads the open sales leads, decides what is overdue or due today and
// emails the owner, or sends nothing when there is nothing to chase. This route only authenticates the cron
// call and passes it on with the shared DISPATCH_SECRET (x-dispatch-secret), the same server-to-server path
// /api/cron/prospect-sequence uses.
export async function GET(request: Request) {
  const cronSecret = process.env.CRON_SECRET;
  if (!cronSecret) {
    return NextResponse.json({ error: "CRON_SECRET is not configured." }, { status: 500 });
  }
  if (!isValidCronRequest(request, cronSecret)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const baseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const dispatchSecret = process.env.DISPATCH_SECRET;
  if (!baseUrl || !dispatchSecret) {
    return NextResponse.json({ error: "DISPATCH_SECRET or NEXT_PUBLIC_SUPABASE_URL is not configured." }, { status: 500 });
  }

  try {
    const res = await fetch(`${baseUrl}/functions/v1/send-followup-digest`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-dispatch-secret": dispatchSecret },
      body: "{}",
      cache: "no-store",
      signal: AbortSignal.timeout(25_000),
    });
    const body = (await res.json().catch(() => null)) as Record<string, unknown> | null;
    if (!res.ok) {
      const message = typeof body?.error === "string" ? body.error : `send-followup-digest responded ${res.status}`;
      void sendSecurityAlert("Follow-up digest cron failed", { error: message });
      return NextResponse.json({ error: message }, { status: 502 });
    }
    return NextResponse.json({ ...(body ?? {}), ran_at: new Date().toISOString() });
  } catch (e) {
    const message = e instanceof Error ? e.message : "send-followup-digest request failed.";
    void sendSecurityAlert("Follow-up digest cron failed", { error: message });
    return NextResponse.json({ error: message }, { status: 502 });
  }
}
