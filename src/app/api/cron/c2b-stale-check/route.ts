import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { isValidCronRequest } from "@/lib/cron-auth";
import { alertIfStale } from "@/lib/c2b-attention";

export const dynamic = "force-dynamic";
export const maxDuration = 30;

// Daily backstop for paybill (C2B) events parked as 'deferred_to_stk'. The every-15-minutes resolver runs
// on GitHub Actions and also raises this alert, but if that workflow stops, nothing would notice.
// This route runs on Vercel Cron (different infrastructure) and reads only: it never changes an event.
// No-op (returns 0) while no school is live on C2B. Same auth pattern as /api/cron/fee-reminders.
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

  const result = await alertIfStale(adminClient, { throttleHourly: false });
  if (result.checkFailed) {
    return NextResponse.json({ error: "Stale-deferral check could not read events." }, { status: 500 });
  }
  return NextResponse.json({ stale_deferred: result.staleCount, alerted: result.alerted, ran_at: new Date().toISOString() });
}
