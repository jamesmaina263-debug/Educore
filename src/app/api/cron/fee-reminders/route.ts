import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { isValidCronRequest } from "@/lib/cron-auth";
import { sendSecurityAlert } from "@/lib/security-alert";
import { withTransientAuthRetry } from "@/lib/supabase/retry-transient-auth";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

// Daily sweep for scheduled fee reminders (Phase 1.4). generate_fee_reminders() as service_role looks
// only at schools that have feature.finance.scheduled_reminders on AND an enabled schedule that is
// due today (Africa/Nairobi), and writes DRAFTS only. Nothing is sent: a finance user approves each
// draft in Finance > Reminders. For every school today (flag off everywhere) this returns 0.
// Same auth pattern as /api/cron/school-comms (Vercel Cron sends Authorization: Bearer CRON_SECRET).
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

  const { data, error } = await withTransientAuthRetry(() => adminClient.rpc("generate_fee_reminders"));
  if (error) {
    void sendSecurityAlert("Fee reminders cron (/api/cron/fee-reminders) failed", {
      error: error.message.slice(0, 300),
    });
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({
    fee_reminders_drafted: typeof data === "number" ? data : 0,
    ran_at: new Date().toISOString(),
  });
}
