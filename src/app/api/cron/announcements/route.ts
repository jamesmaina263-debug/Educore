import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { isValidCronRequest } from "@/lib/cron-auth";

export const dynamic = "force-dynamic";

// Same auth pattern as /api/cron/school-comms and /api/cron/billing: Vercel
// Cron sends a GET with Authorization: Bearer <CRON_SECRET>.
//
// INTERIM DEGRADATION, not the original design: this was meant to run every
// 15 minutes (a scheduled announcement is time-sensitive in a way a term
// newsletter isn't -- "remind guardians at 7am" published hours late because
// it shared a daily sweep defeats the point of scheduling it). That schedule
// broke every deploy of `main`: this project is on Vercel's Hobby plan,
// which only allows daily cron jobs, and vercel.json is validated at deploy
// time -- so PR #149 merging it left `main` unable to deploy at all until
// this was reduced to the "0 6 * * *" schedule below.
//
// Two ways to restore real 15-minute responsiveness, neither of which this
// fix attempts (both need a human, not code):
//   1. Upgrade the Vercel project to the Pro plan.
//   2. Trigger this same endpoint from an external scheduler (e.g. a GitHub
//      Actions cron workflow) instead of vercel.json -- Vercel's own cron
//      limit doesn't apply to external callers. Needs a CRON_SECRET-equivalent
//      value added as both a GitHub Actions secret and read here (or a new
//      dedicated secret), since it isn't currently readable outside Vercel's
//      own environment.
// Until one of those happens, a school scheduling an announcement for a
// specific time may see it publish up to ~24h late.
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

  const { data, error } = await adminClient.rpc("publish_due_scheduled_announcements");
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ announcements_published: data, ran_at: new Date().toISOString() });
}
