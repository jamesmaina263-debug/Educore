import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { isValidCronRequest } from "@/lib/cron-auth";
import { sendSecurityAlert } from "@/lib/security-alert";
import {
  MPESA_STALE_PENDING_EVENT,
  STALE_AFTER_MINUTES,
  alertedIdsFromDetails,
  newlyStale,
  oldestAgeMinutes,
  staleWindow,
} from "@/lib/mpesa-stale-pending";

export const dynamic = "force-dynamic";

// Read-only watchdog: flags M-Pesa STK requests that were dispatched to Safaricom but are still
// 'pending' after STALE_AFTER_MINUTES -- i.e. the callback never got processed (the failure mode
// behind the 2026-10-03 "Awaiting response forever" bug, where every genuine callback was
// rejected by the source-IP check and nothing surfaced anywhere). It NEVER changes any
// mpesa_stk_requests / payments row -- it only reads, and writes an alert (Slack + platform_alerts)
// via the existing sendSecurityAlert. Each stuck row alerts once.
//
// Called every 15 minutes by .github/workflows/mpesa-stale-pending-cron.yml with
// EXTERNAL_CRON_SECRET (same pattern as /api/cron/announcements).
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

  let adminClient;
  try {
    adminClient = createAdminClient();
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Admin client not configured." },
      { status: 500 },
    );
  }

  const now = new Date();
  const { olderThan, notOlderThan } = staleWindow(now);

  // Only rows that were actually dispatched (checkout_request_id set). Rows that never reached
  // Safaricom (dispatch failed / never sent) are a different problem and not a "lost callback".
  const { data: rows, error } = await adminClient
    .from("mpesa_stk_requests")
    .select("id, school_id, amount, initiated_at")
    .eq("status", "pending")
    .not("checkout_request_id", "is", null)
    .lt("initiated_at", olderThan)
    .gte("initiated_at", notOlderThan)
    .order("initiated_at", { ascending: true })
    .limit(100);

  if (error) {
    void sendSecurityAlert("M-Pesa stale-pending check (/api/cron/mpesa-stale-pending) failed", { error: error.message });
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  const stale = rows ?? [];
  if (stale.length === 0) {
    return NextResponse.json({ stale: 0, alerted: 0, ran_at: now.toISOString() });
  }

  // Dedup against alerts already raised for these rows. If this lookup fails we alert anyway:
  // a repeated alert is far better than a silent miss.
  const { data: priorAlerts, error: priorError } = await adminClient
    .from("platform_alerts")
    .select("detail")
    .eq("event", MPESA_STALE_PENDING_EVENT)
    .gte("created_at", notOlderThan);
  if (priorError) console.error("mpesa-stale-pending: could not read prior alerts, alerting without dedup", priorError);
  const alreadyAlerted = alertedIdsFromDetails((priorAlerts ?? []).map((a) => a.detail as Record<string, unknown> | null));

  const fresh = newlyStale(stale, alreadyAlerted);
  if (fresh.length === 0) {
    return NextResponse.json({ stale: stale.length, alerted: 0, ran_at: now.toISOString() });
  }

  await sendSecurityAlert(MPESA_STALE_PENDING_EVENT, {
    count: String(fresh.length),
    pending_for_over_minutes: String(STALE_AFTER_MINUTES),
    oldest_age_minutes: String(oldestAgeMinutes(fresh, now)),
    school_ids: [...new Set(fresh.map((r) => r.school_id))].join(","),
    request_ids: fresh.map((r) => r.id).join(","),
    likely_cause:
      "Daraja callback not processed -- check mpesa-stk-callback logs for 'rejected callback' (IP allowlist / token) or 'confirm failed'",
  });

  return NextResponse.json({ stale: stale.length, alerted: fresh.length, ran_at: now.toISOString() });
}
