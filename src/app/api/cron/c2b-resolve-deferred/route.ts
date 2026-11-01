import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { isValidCronRequest } from "@/lib/cron-auth";
import { sendSecurityAlert } from "@/lib/security-alert";

export const dynamic = "force-dynamic";
export const maxDuration = 30;

// Resolves paybill (C2B) events that were parked as 'deferred_to_stk' because a pending STK request
// with the same amount existed when the notification arrived. If the STK path has not recorded the
// payment after the minimum age, c2b_resolve_deferred_events() processes the event (it can still end
// as 'duplicate' when the STK path did record it). The function only touches rows in outcome
// 'deferred_to_stk', which exist only for schools with feature.finance.c2b_capture on AND mode live, so
// this route is a no-op (returns 0) for every school today.
//
// Called every 15 minutes by a GitHub Actions workflow (c2b-resolve-deferred-cron.yml, same as mpesa-stale-pending-cron.yml) with
// EXTERNAL_CRON_SECRET (same pattern as /api/cron/mpesa-stale-pending).
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

  const { data, error } = await adminClient.rpc("c2b_resolve_deferred_events");
  if (error) {
    void sendSecurityAlert("C2B deferred-event resolver (/api/cron/c2b-resolve-deferred) failed", {
      error: error.message.slice(0, 300),
    });
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ resolved: typeof data === "number" ? data : 0, ran_at: new Date().toISOString() });
}
