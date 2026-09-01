import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { isValidCronRequest } from "@/lib/cron-auth";

export const dynamic = "force-dynamic";

// Same auth pattern as /api/cron/school-comms and /api/cron/billing: Vercel
// Cron sends a GET with Authorization: Bearer <CRON_SECRET>.
//
// Runs every 15 minutes (see vercel.json) rather than daily like the other
// sweeps here, since a scheduled announcement is time-sensitive in a way a
// term newsletter isn't -- "remind guardians at 7am" published hours late
// because it shared a daily sweep would defeat the point of scheduling it.
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
