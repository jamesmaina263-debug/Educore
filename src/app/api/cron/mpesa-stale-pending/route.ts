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
  pickReconcileBatch,
  staleWindow,
} from "@/lib/mpesa-stale-pending";

export const dynamic = "force-dynamic";
// The reconcile step below calls the mpesa-stk-query edge function, which spaces its Daraja calls.
export const maxDuration = 60;

// Watchdog for M-Pesa STK requests that were dispatched to Safaricom but are still 'pending'
// after STALE_AFTER_MINUTES -- i.e. the callback never got processed (the failure mode behind the
// 2026-10-03 "Awaiting response forever" bug, where every genuine callback was rejected by the
// source-IP check, and the 2026-10-04 one, where Safaricom never called back at all).
//
// This route itself never writes mpesa_stk_requests / payments. Before alerting it asks the
// mpesa-stk-query edge function to check the stuck rows with Daraja (STK Push Query); that
// function resolves a row only on a FINAL answer, through the same idempotent
// mpesa_stk_callback_confirm() RPC the callback uses. Rows still pending afterwards are alerted
// once each via the existing sendSecurityAlert (Slack + platform_alerts).
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
    .select("id, school_id, amount, initiated_at, last_query_at")
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

  let stale = rows ?? [];
  if (stale.length === 0) {
    return NextResponse.json({ stale: 0, alerted: 0, ran_at: now.toISOString() });
  }

  // Ask Safaricom what actually happened to a batch of the stuck rows. A failure here must never
  // hide the alert below, so errors are logged and the full stale set is alerted on as before.
  let reconciled = 0;
  const batch = pickReconcileBatch(stale);
  let reconcileError: string | null = null;
  try {
    // Authenticates with the shared DISPATCH_SECRET (x-dispatch-secret), NOT the service key as a
    // Bearer token: the gateway 401s an sb_secret_ key (same failure as the dispatch cron).
    const baseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const dispatchSecret = process.env.DISPATCH_SECRET;
    let invokeError: string | null = null;
    if (!baseUrl || !dispatchSecret) {
      invokeError = "DISPATCH_SECRET or NEXT_PUBLIC_SUPABASE_URL is not configured.";
    } else {
      const res = await fetch(`${baseUrl}/functions/v1/mpesa-stk-query`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-dispatch-secret": dispatchSecret },
        body: JSON.stringify({ request_ids: batch.map((r) => r.id) }),
        cache: "no-store",
        signal: AbortSignal.timeout(50_000),
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => null)) as { error?: string } | null;
        invokeError = body?.error ?? `mpesa-stk-query responded ${res.status}`;
      }
    }
    if (invokeError) {
      reconcileError = invokeError;
      console.error("mpesa-stale-pending: mpesa-stk-query invoke failed", invokeError);
    } else {
      const { data: stillPending, error: stillPendingError } = await adminClient
        .from("mpesa_stk_requests")
        .select("id")
        .eq("status", "pending")
        .in("id", batch.map((r) => r.id));
      if (stillPendingError) {
        console.error("mpesa-stale-pending: re-check after reconcile failed", stillPendingError);
      } else {
        const stillPendingIds = new Set((stillPending ?? []).map((r) => r.id));
        const resolvedIds = new Set(batch.filter((r) => !stillPendingIds.has(r.id)).map((r) => r.id));
        reconciled = resolvedIds.size;
        stale = stale.filter((r) => !resolvedIds.has(r.id));
      }
    }
  } catch (e) {
    reconcileError = e instanceof Error ? e.message : String(e);
    console.error("mpesa-stale-pending: reconcile step threw", e);
  }
  // A broken reconcile step used to be invisible (this route still answered 200 and the workflow
  // went green). Make it loud, once per run, without hiding the stale-row alert below.
  if (reconcileError) {
    void sendSecurityAlert("M-Pesa stale-pending reconcile step failed (mpesa-stk-query)", {
      error: reconcileError.slice(0, 300),
      stuck_rows: String(batch.length),
    });
  }

  if (stale.length === 0) {
    return NextResponse.json({ stale: 0, reconciled, alerted: 0, reconcile_error: reconcileError, ran_at: now.toISOString() });
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
    return NextResponse.json({ stale: stale.length, reconciled, alerted: 0, reconcile_error: reconcileError, ran_at: now.toISOString() });
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

  return NextResponse.json({ stale: stale.length, reconciled, alerted: fresh.length, reconcile_error: reconcileError, ran_at: now.toISOString() });
}
