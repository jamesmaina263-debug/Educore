import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { isValidCronRequest } from "@/lib/cron-auth";
import { sendSecurityAlert } from "@/lib/security-alert";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

// School Onboarding & Engagement Monitor: the scheduled half.
//
//  1. onboarding_run_rules() raises dashboard alerts for the team (password pending 48h, no setup 48h, inactive 7
//     days), clears the ones that no longer apply, and -- only if a super admin has approved the two templates and
//     switched automation on -- queues the two automatic service emails through the existing trial-nudge safeguards.
//  2. Queued automatic emails are handed to the send-owner-campaign Edge Function in its narrow service mode. The
//     function re-verifies the school's CURRENT state before anything goes out (a password reminder is never sent
//     once the password has changed; login guidance never once the administrator has logged in), then sends through
//     the existing campaign pipeline and records the outcome in the audit trail.
//
// If ONBOARDING_SEND_SECRET is not configured the monitor still runs alerts, but queues no email, so nothing is
// left waiting that cannot be sent. Nothing here ever sends WhatsApp or any message other than those two templates.
//
// Called every 30 minutes by .github/workflows/onboarding-monitor-cron.yml with EXTERNAL_CRON_SECRET (same pattern
// as /api/cron/trial-outbound-watch). The response carries counts only: no school names, addresses or message text.

const MAX_SENDS_PER_RUN = 10;

type SendOutcome = "sent" | "cancelled" | "pending" | "error";

export async function GET(request: Request) {
  const cronSecret = process.env.CRON_SECRET;
  const externalCronSecret = process.env.EXTERNAL_CRON_SECRET;
  if (!cronSecret && !externalCronSecret) {
    return NextResponse.json({ error: "Neither CRON_SECRET nor EXTERNAL_CRON_SECRET is configured." }, { status: 500 });
  }
  const authorized =
    (!!cronSecret && isValidCronRequest(request, cronSecret)) ||
    (!!externalCronSecret && isValidCronRequest(request, externalCronSecret));
  if (!authorized) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let admin;
  try {
    admin = createAdminClient();
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "Admin client not configured." }, { status: 500 });
  }

  const sendSecret = process.env.ONBOARDING_SEND_SECRET ?? "";
  const sendConfigured = sendSecret.length >= 32;

  const fail = (step: string, message: string) => {
    void sendSecurityAlert("Onboarding monitor (/api/cron/onboarding-monitor) failed", { step, error: message.slice(0, 300) });
    return NextResponse.json({ error: message, step }, { status: 500 });
  };

  const { data: rules, error: rulesError } = await admin.rpc("onboarding_run_rules", { p_queue_emails: sendConfigured });
  if (rulesError) return fail("run_rules", rulesError.message);

  const outcomes: Record<SendOutcome, number> = { sent: 0, cancelled: 0, pending: 0, error: 0 };
  let queuedFound = 0;

  if (sendConfigured) {
    const { data: pending, error: pendingError } = await admin.rpc("onboarding_pending_sends", { p_limit: MAX_SENDS_PER_RUN });
    if (pendingError) return fail("pending_sends", pendingError.message);

    const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
    const list = (pending ?? []) as { nudge_id: string }[];
    queuedFound = list.length;

    if (list.length > 0 && (!url || !serviceKey)) return fail("send", "Supabase URL or service key is not configured.");

    // One at a time: each call re-checks the school's current state, and a slow provider should not fan out.
    for (const item of list) {
      try {
        const res = await fetch(`${url}/functions/v1/send-owner-campaign`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            // The gateway requires a valid JWT (verify_jwt); the function itself requires the shared secret below.
            Authorization: `Bearer ${serviceKey}`,
            "x-onboarding-send-secret": sendSecret,
          },
          body: JSON.stringify({ onboarding_nudge_id: item.nudge_id }),
        });
        const body = (await res.json().catch(() => ({}))) as { sent?: number; cancelled?: string; pending?: string; error?: string };
        if (!res.ok || body.error) outcomes.error++;
        else if (body.cancelled) outcomes.cancelled++;
        else if (body.pending) outcomes.pending++;
        else outcomes.sent++;
      } catch {
        outcomes.error++;
      }
    }
    if (outcomes.error > 0) {
      void sendSecurityAlert("Onboarding monitor could not send some automatic emails", { failed: String(outcomes.error), attempted: String(list.length) });
    }
  }

  return NextResponse.json({
    ...(rules as Record<string, unknown>),
    send_configured: sendConfigured,
    queued_found: queuedFound,
    send_outcomes: outcomes,
    ran_at: new Date().toISOString(),
  });
}
