import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { isValidCronRequest } from "@/lib/cron-auth";
import { sendSecurityAlert } from "@/lib/security-alert";
import { withTransientAuthRetry } from "@/lib/supabase/retry-transient-auth";
import { runScheduledInvoicing } from "@/lib/billing/cycle";

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
  //
  // Each call is individually wrapped so a transient gateway auth blip on one RPC (see
  // retry-transient-auth.ts) doesn't fail the other two, and retries in place without
  // disturbing the concurrency.
  const [expiredTrials, overdueInvoices, suspendedSchools] = await Promise.all([
    withTransientAuthRetry(() => adminClient.rpc("expire_trials")),
    withTransientAuthRetry(() => adminClient.rpc("mark_invoices_overdue")),
    withTransientAuthRetry(() =>
      adminClient.rpc("suspend_schools_with_overdue_invoices", { p_grace_days: 7 }),
    ),
  ]);

  const errors = [expiredTrials.error, overdueInvoices.error, suspendedSchools.error].filter(
    Boolean,
  );
  if (errors.length > 0) {
    void sendSecurityAlert("Billing cron (/api/cron/billing) failed", {
      error: errors.map((e) => e?.message).join("; "),
    });
    return NextResponse.json(
      { error: errors.map((e) => e?.message).join("; ") },
      { status: 500 },
    );
  }

  // Automated invoicing (end-of-term invoices). Deliberately AFTER the three steps above and isolated:
  // it is a no-op until an administrator enables it in /admin/billing/settings, and a failure here is
  // alerted and reported but never turns the (already completed) enforcement steps above into a 500.
  let invoicing;
  try {
    invoicing = await runScheduledInvoicing(adminClient);
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    void sendSecurityAlert("Automated invoicing crashed", { error: message });
    invoicing = { ran: false, error: message };
  }

  return NextResponse.json({
    expired_trials: expiredTrials.data,
    invoices_marked_overdue: overdueInvoices.data,
    schools_suspended: suspendedSchools.data,
    invoicing,
    ran_at: new Date().toISOString(),
  });
}
