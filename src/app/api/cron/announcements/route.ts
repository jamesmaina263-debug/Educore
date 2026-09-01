import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { isValidCronRequest } from "@/lib/cron-auth";

export const dynamic = "force-dynamic";

// Two callers now hit this route with the same Authorization: Bearer <secret>
// shape (see isValidCronRequest):
//   1. Vercel's own native cron (vercel.json), still on its Hobby-plan-forced
//      daily "0 6 * * *" schedule (see PR #153) -- kept as a same-day safety
//      net even now that (2) exists, in case the GitHub Actions run is ever
//      disabled/failing silently. Authenticates with CRON_SECRET, same as
//      every other route under /api/cron.
//   2. A GitHub Actions workflow (.github/workflows/announcements-cron.yml)
//      running every 15 minutes, restoring the original real-time-ish
//      responsiveness the Hobby plan limit took away. Vercel's cron-schedule
//      restriction only applies to schedules *defined in vercel.json* -- an
//      external caller hitting the same route on any cadence is unaffected,
//      which is what PR #153's own writeup identified as the real fix.
//      Authenticates with EXTERNAL_CRON_SECRET, a separate value from
//      CRON_SECRET (not reused) so this route's two callers can be revoked
//      independently and so this workflow never needs the same secret every
//      other /api/cron route trusts.
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

  const { data, error } = await adminClient.rpc("publish_due_scheduled_announcements");
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ announcements_published: data, ran_at: new Date().toISOString() });
}
