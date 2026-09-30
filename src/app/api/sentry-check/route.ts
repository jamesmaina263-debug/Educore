import * as Sentry from "@sentry/nextjs";
import { NextResponse } from "next/server";
import { isValidCronRequest } from "@/lib/cron-auth";

// Verification endpoint for the Sentry setup (gap analysis Tier 2 #15) -- deliberately throws so
// we can confirm an error actually reaches the Sentry dashboard end-to-end, not just that the SDK
// initialized without complaint. Each call sends an event and waits on a flush, so it requires
// the same Bearer CRON_SECRET as the cron routes: `curl -H "Authorization: Bearer $CRON_SECRET" <url>`.
export async function GET(request: Request) {
  const cronSecret = process.env.CRON_SECRET;
  if (!cronSecret) {
    return NextResponse.json({ error: "CRON_SECRET is not configured." }, { status: 500 });
  }
  if (!isValidCronRequest(request, cronSecret)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    throw new Error("EduCore Sentry verification test error — safe to ignore/resolve in Sentry.");
  } catch (error) {
    Sentry.captureException(error);
    await Sentry.flush(2000);
    return NextResponse.json({ ok: true, message: "Test error sent to Sentry." });
  }
}
