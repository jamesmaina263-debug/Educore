import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { isValidCronRequest } from "@/lib/cron-auth";
import { sendSecurityAlert } from "@/lib/security-alert";
import { summariseDirectorBriefings, type DirectorBriefingRow } from "@/lib/director-messages";

export const dynamic = "force-dynamic";

// WP 3.1 director morning briefing / Saturday digest, DRY-RUN. Every 15 minutes this asks
// director_briefing_evaluate() what is due. The function itself enforces both feature flags, the director's own WhatsApp
// opt-in, the school's briefing window (default 07:00 to 10:00 Nairobi, Monday to Saturday) and once-per-day delivery, and
// records each briefing as 'would_send'. THIS ROUTE SENDS NOTHING: there is no WhatsApp or SMS call in it. It formats each
// briefing in memory only to check the figures are well formed, then throws the text away, and returns counts only (never
// phones, figures or text). Real sending needs approved Twilio templates, a consent-wording decision (the 3.3 opt-in covers
// answers "when I ask", not pushes) and a test-number-first rollout, and will be a separate, reviewed change.
//
// Called by .github/workflows/director-briefing-cron.yml with EXTERNAL_CRON_SECRET (same pattern as /api/cron/director-alerts).
// With the flags off everywhere (the default) it returns total 0.
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

  const { data, error } = await adminClient.rpc("director_briefing_evaluate");
  if (error) {
    void sendSecurityAlert("Director briefing check (/api/cron/director-briefing) failed", { error: error.message.slice(0, 300) });
    return NextResponse.json({ error: "evaluate failed" }, { status: 500 });
  }

  return NextResponse.json({
    mode: "dry_run",
    ...summariseDirectorBriefings(data as DirectorBriefingRow[] | null),
    ran_at: new Date().toISOString(),
  });
}
