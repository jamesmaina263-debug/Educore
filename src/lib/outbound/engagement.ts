import { isTrackedDestination, type TrackedDestination } from "./tracked-links";

// Per-school engagement shown on the Outreach page, from admin_outreach_engagement().
// "clicks" are our own tracked-link clicks with probable scanners already removed by the database.
// Opens are a weak signal (Apple Mail pre-loads images), so they are shown but never count as "clicked".
export type ProspectEngagement = {
  clicks: number;
  lastClickAt: string | null;
  destinations: TrackedDestination[];
  opens: number;
  lastOpenAt: string | null;
  providerClicks: number;
  lastProviderClickAt: string | null;
};

function count(v: unknown): number {
  return typeof v === "number" && Number.isFinite(v) && v > 0 ? Math.floor(v) : 0;
}
function when(v: unknown): string | null {
  return typeof v === "string" && !Number.isNaN(new Date(v).getTime()) ? v : null;
}

/** Turns the RPC result into a map keyed by prospect id. Never throws; anything unexpected is skipped. */
export function parseEngagementRows(raw: unknown): Record<string, ProspectEngagement> {
  const out: Record<string, ProspectEngagement> = {};
  if (!Array.isArray(raw)) return out;
  for (const row of raw) {
    if (!row || typeof row !== "object") continue;
    const r = row as Record<string, unknown>;
    if (typeof r.prospect_id !== "string" || !r.prospect_id) continue;
    const destinations = Array.isArray(r.destinations)
      ? r.destinations.filter((d): d is TrackedDestination => typeof d === "string" && isTrackedDestination(d))
      : [];
    out[r.prospect_id] = {
      clicks: count(r.clicks),
      lastClickAt: when(r.last_click_at),
      destinations,
      opens: count(r.opens),
      lastOpenAt: when(r.last_open_at),
      providerClicks: count(r.provider_clicks),
      lastProviderClickAt: when(r.last_provider_click_at),
    };
  }
  return out;
}

const DESTINATION_LABELS: Record<TrackedDestination, string> = {
  signup: "signup page",
  contact: "contact page",
  brochure: "brochure",
  home: "home page",
};

/** True when the school clicked a link in the email (ours, or one Resend reported). Opens alone do not count. */
export function hasClicked(e: ProspectEngagement | undefined): boolean {
  return !!e && (e.clicks > 0 || e.providerClicks > 0);
}

export type EngagementLine = { tone: "strong" | "weak"; text: string; at: string | null };

/** The lines to show under a school's status: what they clicked (strong), and whether the email was opened (weak). */
export function engagementLines(e: ProspectEngagement | undefined): EngagementLine[] {
  if (!e) return [];
  const lines: EngagementLine[] = [];
  if (e.clicks > 0) {
    const where = e.destinations.map((d) => DESTINATION_LABELS[d]).join(", ");
    lines.push({ tone: "strong", text: where ? `Clicked: ${where}` : "Clicked a link", at: e.lastClickAt });
  } else if (e.providerClicks > 0) {
    lines.push({ tone: "strong", text: "Clicked a link", at: e.lastProviderClickAt });
  }
  if (e.opens > 0) lines.push({ tone: "weak", text: "Opened (may be automatic)", at: e.lastOpenAt });
  return lines;
}
