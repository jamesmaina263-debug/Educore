import { SITE_URL } from "@/lib/site";
import { outreachLink, type OutreachChannel } from "./prospects";

// Per-school tracked links in outreach emails. The email carries /api/outreach-link/<recipient id>/<destination>;
// the route records the click for that school and redirects to the real page with the same UTM tags the untracked
// links always had. The destination is a fixed key, never a URL taken from the request, so the route cannot be
// used as an open redirect. Keys and paths must match the check in record_outreach_click().
export const TRACKED_DESTINATIONS = ["home", "signup", "contact", "brochure"] as const;
export type TrackedDestination = (typeof TRACKED_DESTINATIONS)[number];

const PATHS: Record<TrackedDestination, "" | "/signup" | "/contact" | "/brochure"> = {
  home: "",
  signup: "/signup",
  contact: "/contact",
  brochure: "/brochure",
};

export function isTrackedDestination(value: string): value is TrackedDestination {
  return (TRACKED_DESTINATIONS as readonly string[]).includes(value);
}

/** The page a tracked link lands on: identical to the untracked link of that channel, UTM tags included. */
export function trackedDestinationUrl(dest: TrackedDestination, channel: OutreachChannel = "email"): string {
  return outreachLink(PATHS[dest], channel);
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

// WhatsApp drafts are copied and pasted by a rep, so there is no per-send recipient row. When the rep copies a
// draft, its fixed links (built by outreachLink(..., "whatsapp")) are swapped for
// <site>/api/outreach-link/wa/<school's prospect id>/<page>, which records the click for that school and
// redirects to the same page with the same UTM tags. Only those exact links on our own site are touched.
export function trackWhatsAppLinks(text: string, prospectId: string, siteUrl: string = SITE_URL): string {
  const site = siteUrl.replace(/\/$/, "");
  if (!site || !UUID_RE.test(prospectId)) return text;
  const re = new RegExp(
    `${escapeRegExp(site)}(/(?:signup|contact|brochure)?)\\?utm_source=outreach&utm_medium=whatsapp&utm_campaign=school_outreach&utm_content=(home|signup|contact|brochure)(?![\\w&=%])`,
    "g",
  );
  return text.replace(re, (whole, path: string, key: string) =>
    isTrackedDestination(key) && PATHS[key] === (path === "/" ? "" : path) ? `${site}/api/outreach-link/wa/${prospectId}/${key}` : whole,
  );
}
