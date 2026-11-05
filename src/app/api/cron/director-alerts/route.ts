import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { isValidCronRequest } from "@/lib/cron-auth";
import { sendSecurityAlert } from "@/lib/security-alert";
import { summariseDirectorAlerts, type DirectorAlertRow } from "@/lib/director-alerts";

export const dynamic = "force-dynamic";

// WP 3.2 director alerts, DRY-RUN. Every 15 minutes this asks director_alerts_evaluate() what is due. The
// function itself enforces both feature flags, the director's own WhatsApp opt-in, Nairobi quiet hours, the
// daily cap and once-only delivery, and records each alert as 'would_send'. THIS ROUTE SENDS NOTHING: there is
// no WhatsApp or SMS call in it, and it returns counts only (never phones or figures). Real sending needs
// approved Twilio templates and a test-number-first rollout, and will be a separate, reviewed change.
//
// Called by .github/workflows/director-alerts-cron.yml with EXTERNAL_CRON_SECRET (same pattern as
// /api/cron/mpesa-stale-pending). With the flags off everywhere (the default) it returns total 0.
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
    return NextResponse.json({ error: e instanceof Error ? e.message : "Admin client not configured." }, { status: 500 });
  }

  const { data, error } = await adminClient.rpc("director_alerts_evaluate");
  if (error) {
    void sendSecurityAlert("Director alerts check (/api/cron/director-alerts) failed", { error: error.message.slice(0, 300) });
    return NextResponse.json({ error: "evaluate failed" }, { status: 500 });
  }

  return NextResponse.json({
    mode: "dry_run",
    ...summariseDirectorAlerts(data as DirectorAlertRow[] | null),
    ran_at: new Date().toISOString(),
  });
}
