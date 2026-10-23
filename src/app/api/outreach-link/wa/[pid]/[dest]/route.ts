import { NextResponse, after, type NextRequest } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { isBotUserAgent } from "@/lib/marketing/page-view";
import { hasInternalVisitorCookie } from "@/lib/marketing/internal-visitor";
import { isTrackedDestination, trackedDestinationUrl } from "@/lib/outbound/tracked-links";
import { SITE_URL } from "@/lib/site";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// GET /api/outreach-link/wa/[pid]/[dest] -> the per-school tracked link in WhatsApp outreach messages.
//
// [pid] is the school's outbound_prospects id (an unguessable uuid); [dest] is one of home | signup | contact |
// brochure. The rep's copy button puts this link in the message (src/lib/outbound/tracked-links.ts). The click is
// recorded against that school (record_outreach_whatsapp_click, which only accepts a school whose WhatsApp draft
// was copied or marked sent) and the visitor is redirected to the same page, with the same UTM tags, the untracked
// link always went to. The destination comes from a fixed list, so this is not an open redirect.
//
// Same guarantees as the email route (src/app/api/outreach-link/[rid]/[dest]): the visitor is ALWAYS redirected
// (a bad link goes to the home page; a database failure only means the click is not recorded); recording happens
// after the response; HEAD requests and staff browsers record nothing.
//
// WhatsApp fetches a preview of every link the moment a message is sent, identifying itself as "WhatsApp/<version>".
// That fetch (and any other automated user agent) is stored but flagged as a probable scanner by the database
// call, so a preview never looks like the school showing interest.
const HEADERS = { "Cache-Control": "no-store", "Referrer-Policy": "no-referrer" };
const WHATSAPP_PREVIEW_AGENT = /whatsapp\//i;

function redirectTo(url: string) {
  return NextResponse.redirect(url, { status: 302, headers: HEADERS });
}

type Params = { params: Promise<{ pid: string; dest: string }> };

function resolveTarget(pid: string, dest: string): { target: string; valid: boolean } {
  if (!UUID_RE.test(pid) || !isTrackedDestination(dest)) return { target: `${SITE_URL}/`, valid: false };
  return { target: trackedDestinationUrl(dest, "whatsapp"), valid: true };
}

export async function GET(request: NextRequest, { params }: Params) {
  const { pid, dest } = await params;
  const { target, valid } = resolveTarget(pid, dest);

  if (valid && !hasInternalVisitorCookie(request.headers.get("cookie"))) {
    const userAgent = request.headers.get("user-agent");
    const probableBot = isBotUserAgent(userAgent) || WHATSAPP_PREVIEW_AGENT.test(userAgent ?? "");
    after(async () => {
      try {
        const { error } = await createAdminClient().rpc("record_outreach_whatsapp_click", {
          p_prospect_id: pid,
          p_destination: dest,
          p_is_probable_bot: probableBot,
        });
        if (error) console.error("outreach-link/wa: record_outreach_whatsapp_click failed", error.message);
      } catch (err) {
        console.error("outreach-link/wa: unexpected error recording a click", err);
      }
    });
  }

  return redirectTo(target);
}

// Link-preview fetchers and scanners often probe with HEAD first; that must never count as a click.
export async function HEAD(_request: NextRequest, { params }: Params) {
  const { pid, dest } = await params;
  return redirectTo(resolveTarget(pid, dest).target);
}
