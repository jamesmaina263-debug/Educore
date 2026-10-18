import { NextResponse, after, type NextRequest } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { getRealClientIp } from "@/lib/get-real-client-ip";
import {
  PAGE_VIEW_MAX_BODY_BYTES,
  countryFromHeader,
  deviceFromUserAgent,
  isBotUserAgent,
  parsePageViewPayload,
} from "@/lib/marketing/page-view";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

// POST /api/page-view -> records one anonymous page view of the public marketing site in our own
// database (public.site_page_views), so the admin console can show today's traffic without waiting
// for Google's reports, which trail by hours.
//
// Deliberately unauthenticated (it is called by anonymous visitors' browsers) and deliberately
// answers 204 to everything -- accepted, dropped, or failed -- so it reveals nothing to a caller
// and a hiccup never shows up in a visitor's browser. Because it is public it is bounded:
//   * a tiny body limit and strict validation (see src/lib/marketing/page-view.ts),
//   * same-origin only (Sec-Fetch-Site) and no known bots,
//   * a per-visitor cap of 300 views/hour enforced inside record_page_view(),
//   * the write happens after the response (after()) so it never slows a page down.
//
// Privacy: the IP address and user agent are passed to the database function only so it can hash
// them with a random per-day salt; neither is stored. See the migration header for the full list
// of what is and is not recorded.
const NO_CONTENT_HEADERS = { "Cache-Control": "no-store" };

function noContent() {
  return new NextResponse(null, { status: 204, headers: NO_CONTENT_HEADERS });
}

export async function POST(request: NextRequest) {
  try {
    // Browsers set this on every request; anything not same-origin (a script on another site, a
    // hand-rolled cross-site form) is not our beacon. Absent on very old browsers -- allowed.
    const fetchSite = request.headers.get("sec-fetch-site");
    if (fetchSite && fetchSite !== "same-origin") return noContent();

    const userAgent = request.headers.get("user-agent");
    if (isBotUserAgent(userAgent)) return noContent();

    const declared = Number(request.headers.get("content-length") ?? "0");
    if (declared > PAGE_VIEW_MAX_BODY_BYTES) return noContent();
    const raw = await request.text();
    if (raw.length > PAGE_VIEW_MAX_BODY_BYTES) return noContent();

    const input = parsePageViewPayload(JSON.parse(raw), request.headers.get("host"));
    if (!input) return noContent();

    const ip = getRealClientIp(request.headers.get("x-forwarded-for"));
    const country = countryFromHeader(request.headers.get("x-vercel-ip-country"));
    const device = deviceFromUserAgent(userAgent);

    after(async () => {
      try {
        const { error } = await createAdminClient().rpc("record_page_view", {
          p_path: input.path,
          p_ip: ip,
          p_user_agent: userAgent ?? "",
          p_country: country,
          p_device: device,
          p_referrer_host: input.referrerHost,
          p_utm_source: input.utmSource,
          p_utm_medium: input.utmMedium,
          p_utm_campaign: input.utmCampaign,
          p_click_platform: input.clickPlatform,
          p_is_entry: input.isEntry,
        });
        if (error) console.error("page-view: record_page_view failed", error.message);
      } catch (err) {
        console.error("page-view: unexpected error recording a page view", err);
      }
    });
  } catch {
    // Malformed body or anything unexpected: nothing to record, nothing to tell the caller.
  }
  return noContent();
}
