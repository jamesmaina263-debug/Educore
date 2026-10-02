import { NextResponse } from "next/server";
import { isValidCronRequest } from "@/lib/cron-auth";
import { sendSecurityAlert } from "@/lib/security-alert";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

// Daily trigger for the automated prospect email sequence. All the real work (who is due, the
// on/off switch, suppression, never-send-twice) is in the send-prospect-sequence Edge Function and
// the claim_prospect_sequence_sends() SQL function behind it; this route only authenticates the
// cron call and loops the function until a call claims less than a full batch.
//
// Authenticates to the function with the shared DISPATCH_SECRET (x-dispatch-secret), the same
// server-to-server path /api/cron/dispatch-communications uses.
const BATCH_SIZE = 40; // keep in step with send-prospect-sequence
const MAX_PAGES_PER_RUN = 5; // up to 200 emails per run; the rest follow on the next daily run

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

  let claimed = 0;
  let sent = 0;
  let failed = 0;

  for (let page = 0; page < MAX_PAGES_PER_RUN; page++) {
    let pageClaimed = 0;
    try {
      const res = await fetch(`${baseUrl}/functions/v1/send-prospect-sequence`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-dispatch-secret": dispatchSecret },
        body: "{}",
        cache: "no-store",
        signal: AbortSignal.timeout(50_000),
      });
      const body = (await res.json().catch(() => null)) as
        | { claimed?: number; sent?: number; failed?: number; error?: string }
        | null;
      if (!res.ok) {
        const message = body?.error ?? `send-prospect-sequence responded ${res.status}`;
        void sendSecurityAlert("Prospect-sequence cron failed", {
          error: message,
          sent_before_failure: String(sent),
        });
        return NextResponse.json({ error: message, claimed, sent, failed }, { status: 502 });
      }
      pageClaimed = body?.claimed ?? 0;
      claimed += pageClaimed;
      sent += body?.sent ?? 0;
      failed += body?.failed ?? 0;
    } catch (e) {
      const message = e instanceof Error ? e.message : "send-prospect-sequence request failed.";
      void sendSecurityAlert("Prospect-sequence cron failed", { error: message, sent_before_failure: String(sent) });
      return NextResponse.json({ error: message, claimed, sent, failed }, { status: 502 });
    }
    if (pageClaimed < BATCH_SIZE) break; // queue drained for today
  }

  return NextResponse.json({ claimed, sent, failed, ran_at: new Date().toISOString() });
}
