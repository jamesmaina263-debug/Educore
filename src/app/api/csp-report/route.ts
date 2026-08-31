import { NextResponse, type NextRequest } from "next/server";

// Receives CSP violation reports so flipping the policy from Report-Only to
// enforcing (see next.config.ts) isn't a "ship it and hope" move -- if the
// static-code audit that fixed this policy missed something (a resource
// this app loads that isn't covered by an existing directive), the browser
// reports it here instead of just silently failing for whoever hit it,
// with zero server-side visibility.
//
// Handles both the legacy `report-uri` format (Content-Type:
// application/csp-report, body wrapped in a top-level "csp-report" key) and
// the modern `report-to` format (Content-Type: application/reports+json, a
// JSON array of report objects) -- browser support for each is still split,
// so next.config.ts sends both directives and this endpoint accepts either.
//
// Deliberately unauthenticated (browsers send these with no credentials by
// design) and deliberately not stored in the app database -- this is
// operational signal, not tenant data. Logged via console.error so it shows
// up in Vercel's runtime logs (and Sentry, which captures server console
// errors) without needing a new table/RLS surface for what should be a
// short-lived diagnostic tool once the enforcing policy has run clean for a
// while.
export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const reports = Array.isArray(body) ? body : [body];
    for (const report of reports) {
      const csp = report.body ?? report["csp-report"] ?? report;
      console.error("[csp-violation]", JSON.stringify(csp));
    }
  } catch {
    // Malformed report body -- nothing to act on, don't fail the (fire-and-forget) beacon.
  }
  return NextResponse.json({ ok: true }, { status: 202 });
}
