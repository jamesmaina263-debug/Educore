import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { isValidCronRequest } from "@/lib/cron-auth";

export const dynamic = "force-dynamic";

// Vercel Cron sends this route a GET with an Authorization: Bearer <CRON_SECRET>
// header automatically when CRON_SECRET is set in the project's env vars.
// See https://vercel.com/docs/cron-jobs/manage-cron-jobs#securing-cron-jobs
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

  // Each RPC runs as the service_role JWT, which start_trial_subscription and
  // friends explicitly allow alongside auth_is_super_admin() — see the
  // billing migration comments.
  const [expiredTrials, overdueInvoices, suspendedSchools] = await Promise.all([
    adminClient.rpc("expire_trials"),
    adminClient.rpc("mark_invoices_overdue"),
    adminClient.rpc("suspend_schools_with_overdue_invoices", { p_grace_days: 7 }),
  ]);

  const errors = [expiredTrials.error, overdueInvoices.error, suspendedSchools.error].filter(
    Boolean,
  );
  if (errors.length > 0) {
    return NextResponse.json(
      { error: errors.map((e) => e?.message).join("; ") },
      { status: 500 },
    );
  }

  return NextResponse.json({
    expired_trials: expiredTrials.data,
    invoices_marked_overdue: overdueInvoices.data,
    schools_suspended: suspendedSchools.data,
    ran_at: new Date().toISOString(),
  });
}
