import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { isValidCronRequest } from "@/lib/cron-auth";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

// Sweeps status='queued' notification_logs rows across every school, instead of relying on a
// staff member happening to open the Communication page (the previous only trigger — see the
// send-communication Edge Function's comment). Two system-initiated sources depend on this:
// the 3-consecutive-absence alert trigger and the online-admission confirmation SMS
// (apply/[slug]/actions.ts's admin.functions.invoke call), neither of which has a page for a
// staff member to open.
//
// send-communication pages 100 rows per invocation by design (see its own comment on why), so
// this loops it — bounded to 10 pages (1,000 messages) per cron run so one very large backlog
// can't turn into a run that overlaps the next scheduled tick. A backlog bigger than that just
// finishes over successive runs; nothing is lost, status stays 'queued' until actually sent.
const MAX_PAGES_PER_RUN = 10;

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

  let totalSent = 0;
  let totalFailed = 0;
  let pages = 0;

  for (; pages < MAX_PAGES_PER_RUN; pages++) {
    const { data, error } = await adminClient.functions.invoke("send-communication");
    if (error) {
      // Report what was swept before the failure rather than discarding it — a partial sweep is
      // still real progress, and the next scheduled run picks up wherever this one left off.
      return NextResponse.json(
        {
          error: error.message,
          pages_completed: pages,
          sent: totalSent,
          failed: totalFailed,
        },
        { status: 502 },
      );
    }
    const total = (data?.total as number | undefined) ?? 0;
    totalSent += (data?.sent as number | undefined) ?? 0;
    totalFailed += (data?.failed as number | undefined) ?? 0;
    if (total < 100) break; // fewer than a full page came back — queue is drained for now
  }

  return NextResponse.json({
    pages: pages + 1,
    sent: totalSent,
    failed: totalFailed,
    ran_at: new Date().toISOString(),
  });
}
