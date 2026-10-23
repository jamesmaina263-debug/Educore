import { NextResponse, after, type NextRequest } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { isBotUserAgent } from "@/lib/marketing/page-view";
import { hasInternalVisitorCookie } from "@/lib/marketing/internal-visitor";
import { isTrackedDestination, trackedDestinationUrl } from "@/lib/outbound/tracked-links";
import { SITE_URL } from "@/lib/site";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// GET /api/outreach-link/[rid]/[dest] -> the per-school tracked link in outreach emails.
//
// [rid] is the id of the school's email_campaign_recipients row (an unguessable uuid); [dest] is one of
// home | signup | contact | brochure. The click is recorded against that school (record_outreach_click) and the
// visitor is redirected to the same page, with the same UTM tags, the untracked link always went to. The
// destination is looked up from a fixed list, so this is not an open redirect.
//
// The visitor is ALWAYS redirected, whatever happens: a malformed or unknown link goes to the home page, and a
// database failure only means the click is not recorded. Recording happens after the response (after()) so it
// never slows the redirect. Nothing is recorded for HEAD requests, for a staff browser marked "don't count my
// visits", or when the recipient is not a sent outreach email (the database function decides that). Clicks
// whose user agent looks automated, or that arrive seconds after sending, are stored but flagged as probable
// scanners by the database, so mail-security prefetching does not look like interest.
const HEADERS = { "Cache-Control": "no-store", "Referrer-Policy": "no-referrer" };

function redirectTo(url: string) {
  return NextResponse.redirect(url, { status: 302, headers: HEADERS });
}

type Params = { params: Promise<{ rid: string; dest: string }> };

function resolveTarget(rid: string, dest: string): { target: string; valid: boolean } {
  if (!UUID_RE.test(rid) || !isTrackedDestination(dest)) return { target: `${SITE_URL}/`, valid: false };
  return { target: trackedDestinationUrl(dest), valid: true };
}

export async function GET(request: NextRequest, { params }: Params) {
  const { rid, dest } = await params;
  const { target, valid } = resolveTarget(rid, dest);

  if (valid && !hasInternalVisitorCookie(request.headers.get("cookie"))) {
    const probableBot = isBotUserAgent(request.headers.get("user-agent"));
    after(async () => {
      try {
        const { error } = await createAdminClient().rpc("record_outreach_click", {
          p_recipient_id: rid,
          p_destination: dest,
          p_is_probable_bot: probableBot,
        });
        if (error) console.error("outreach-link: record_outreach_click failed", error.message);
      } catch (err) {
        console.error("outreach-link: unexpected error recording a click", err);
      }
    });
  }

  return redirectTo(target);
}

// Scanners often probe with HEAD first; that must never count as a click.
export async function HEAD(_request: NextRequest, { params }: Params) {
  const { rid, dest } = await params;
  return redirectTo(resolveTarget(rid, dest).target);
}
