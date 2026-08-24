import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { isValidCronRequest } from "@/lib/cron-auth";

export const dynamic = "force-dynamic";

// Vercel Cron sends this route a GET with an Authorization: Bearer <CRON_SECRET>
// header automatically when CRON_SECRET is set in the project's env vars.
// See https://vercel.com/docs/cron-jobs/manage-cron-jobs#securing-cron-jobs
//
// Two-step retention sweep for communication history (notification_logs +
// whatsapp_conversations): archive anything inactive 7+ days, then permanently purge
// anything archived 7+ days ago (14 days total). Both RPCs are idempotent -- safe if this
// route runs twice or a previous run failed partway. See
// 20260824153119_communication_retention_archive_purge.sql for the full retention design,
// including why purge writes a PII-minimized snapshot to audit_log before deleting.
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

  // Archive must run before purge in the same invocation so that anything crossing the
  // 7-day line today is already archived (and thus correctly excluded from this run's
  // purge, since purge only acts on rows with a purge_at already set from a *previous*
  // archive pass) -- this mirrors expire_trials() running before
  // suspend_schools_with_overdue_invoices() in the billing cron.
  const archived = await adminClient.rpc("archive_old_communications");
  if (archived.error) {
    return NextResponse.json({ error: archived.error.message }, { status: 500 });
  }

  const purged = await adminClient.rpc("purge_expired_communications");
  if (purged.error) {
    return NextResponse.json({ error: purged.error.message }, { status: 500 });
  }

  return NextResponse.json({
    archived: archived.data,
    purged: purged.data,
    ran_at: new Date().toISOString(),
  });
}
