import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { isValidCronRequest } from "@/lib/cron-auth";

export const dynamic = "force-dynamic";

// Same pattern as /api/cron/billing: Vercel Cron sends a GET with
// Authorization: Bearer <CRON_SECRET>, checked before anything else runs.
// See https://vercel.com/docs/cron-jobs/manage-cron-jobs#securing-cron-jobs
//
// Two sweeps, both idempotent and both safe to run daily with no risk of
// duplicate sends:
// - run_term_newsletter_sweep(): every term whose end_date has passed and has
//   no term_newsletter_log row yet gets its newsletter sent (fee structure for
//   the next term merged in where one exists).
// - check_fee_thresholds(): every school with a configured fee_alert_threshold
//   gets scanned for students whose balance has crossed it. This only ever
//   *drafts* a fee_threshold_alerts row for Finance to review -- it never
//   sends anything by itself. Sending only happens when a Finance user
//   explicitly approves via send_fee_threshold_alert() in the app.
export async function GET(request: Request) {
  const cronSecret = process.env.CRON_SECRET;
  if (!cronSecret) {
    return NextResponse.json({ error: "CRON_SECRET is not configured." }, { status: 500 });
  }
  if (!isValidCronRequest(request, cronSecret)) {
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

  const [newsletterSweep, thresholdCheck] = await Promise.all([
    adminClient.rpc("run_term_newsletter_sweep"),
    adminClient.rpc("check_fee_thresholds"),
  ]);

  const errors = [newsletterSweep.error, thresholdCheck.error].filter(Boolean);
  if (errors.length > 0) {
    return NextResponse.json({ error: errors.map((e) => e?.message).join("; ") }, { status: 500 });
  }

  return NextResponse.json({
    newsletters_sent: newsletterSweep.data,
    fee_threshold_alerts_drafted: thresholdCheck.data,
    ran_at: new Date().toISOString(),
  });
}
