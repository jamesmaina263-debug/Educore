import * as Sentry from "@sentry/nextjs";
import { NextResponse } from "next/server";

// One-time verification endpoint for the Sentry setup (gap analysis Tier 2 #15) — deliberately
// throws so we can confirm an error actually reaches the Sentry dashboard end-to-end, not just
// that the SDK initialized without complaint. Safe to leave in place for future re-checks after
// a Sentry config change; it does nothing unless someone deliberately hits it.
export async function GET() {
  try {
    throw new Error("EduCore Sentry verification test error — safe to ignore/resolve in Sentry.");
  } catch (error) {
    Sentry.captureException(error);
    await Sentry.flush(2000);
    return NextResponse.json({ ok: true, message: "Test error sent to Sentry." });
  }
}
