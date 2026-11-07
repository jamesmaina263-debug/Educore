import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { isValidCronRequest } from "@/lib/cron-auth";
import { sendSecurityAlert } from "@/lib/security-alert";
import { summariseGroupDigests, type GroupDigestRow } from "@/lib/group-digest-messages";

export const dynamic = "force-dynamic";

// WP 3.4 group admin Saturday digest, DRY-RUN. Calls group_digest_evaluate(), which enforces every lock itself (feature flag, school/consent switches, timing window, once-per-key) and
// records each item as 'would_send'. THIS ROUTE SENDS NOTHING: there is no WhatsApp or SMS call in it, and it returns counts only
// (never names, phones, figures or text). Real sending needs approved templates, an owner decision on wording and cost, and a
// test-number-first rollout, and will be a separate, reviewed change. With the flags off everywhere (the default) it returns total 0.
// Called by .github/workflows/group-digest-cron.yml with EXTERNAL_CRON_SECRET (same pattern as /api/cron/director-briefing).
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

  const { data, error } = await adminClient.rpc("group_digest_evaluate");
  if (error) {
    void sendSecurityAlert("WP 3.4 group admin Saturday digest check (/api/cron/group-digest) failed", { error: error.message.slice(0, 300) });
    return NextResponse.json({ error: "evaluate failed" }, { status: 500 });
  }

  return NextResponse.json({
    mode: "dry_run",
    ...summariseGroupDigests(data as GroupDigestRow[] | null),
    ran_at: new Date().toISOString(),
  });
}
