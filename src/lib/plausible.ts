// Server-side client for the Plausible Stats API v2 (POST /api/v2/query).
// Mirrors the same "safe no-op until configured" posture as
// src/components/marketing/analytics.tsx: every exported function returns
// null when Plausible isn't set up yet, rather than throwing or returning
// fabricated numbers. Callers (the admin analytics page) are expected to
// render an explicit "not connected" state for a null result -- see
// src/components/admin/analytics/not-connected-card.tsx.
//
// Requires the Business tier of Plausible (Stats API access) and a Stats
// API key with access to the site's team -- see
// https://plausible.io/docs/stats-api#authentication.

const SITE_ID = process.env.NEXT_PUBLIC_PLAUSIBLE_DOMAIN;
const API_KEY = process.env.PLAUSIBLE_API_KEY;
// Only relevant for self-hosted Plausible -- same default as Plausible's own
// cloud offering. Not the same as NEXT_PUBLIC_PLAUSIBLE_SCRIPT_URL (that's
// the *tracking script* origin; this is the *API* origin -- for a
// self-hosted instance they're typically the same host, but they're
// separate concerns and shouldn't be conflated into one env var).
const API_BASE_URL = process.env.PLAUSIBLE_API_BASE_URL ?? "https://plausible.io";

export function isPlausibleConfigured(): boolean {
  return Boolean(SITE_ID && API_KEY);
}

// NOTE: "new vs. returning visitors" (spec ask under Website Traffic) has
// no equivalent in Plausible's Stats API v2 -- verified against the
// current official dimension list (https://plausible.io/docs/stats-api,
// checked 2026-08-30). There is no visit-count/returning-visitor dimension
// or metric at all; this is a deliberate consequence of Plausible being
// cookie-less and not persisting cross-session visitor identity. Do not
// build a fake version of this (e.g. inferring it from IP/UA hashing) --
// that would reintroduce exactly the fingerprinting the spec explicitly
// prohibits. If this is ever genuinely required, it needs a different
// analytics tool entirely, with a materially different privacy posture
// than the cookie-less one this project deliberately chose.

export type DateRangeInput = "day" | "7d" | "30d" | "91d" | [string, string];

type QueryFilter = [string, string, (string | number)[]] | [string, string, (string | number)[], Record<string, unknown>];

type PlausibleQuery = {
  metrics: string[];
  date_range: DateRangeInput;
  dimensions?: string[];
  filters?: QueryFilter[];
  order_by?: [string, "asc" | "desc"][];
  pagination?: { limit?: number; offset?: number };
};

type PlausibleQueryResult = {
  results: { metrics: (number | string | null)[]; dimensions: string[] }[];
  meta: Record<string, unknown>;
};

// Every caller in this file goes through here. Returns null on any
// configuration gap, network failure, or non-2xx response -- callers treat
// null as "show the not-connected/empty state", never as "zero visitors".
// Those are different facts and must not be conflated (see the
// IMPLEMENTATION POLICY note against ever showing invented/zeroed numbers
// in place of "we don't actually know").
async function queryPlausible(query: PlausibleQuery): Promise<PlausibleQueryResult | null> {
  if (!SITE_ID || !API_KEY) return null;

  try {
    const res = await fetch(`${API_BASE_URL}/api/v2/query`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ site_id: SITE_ID, ...query }),
      // Analytics numbers a few minutes stale are fine for an admin
      // dashboard; this avoids hammering the Stats API's 600 req/hour
      // rate limit if the page or its date-range tabs are hit repeatedly.
      next: { revalidate: 300 },
    });
    if (!res.ok) {
      console.error(`Plausible query failed: ${res.status} ${await res.text()}`);
      return null;
    }
    return (await res.json()) as PlausibleQueryResult;
  } catch (err) {
    console.error("Plausible query threw", err);
    return null;
  }
}

export type OverviewStats = {
  visitors: number;
  visits: number;
  pageviews: number;
  viewsPerVisit: number;
  bounceRate: number;
  visitDurationSeconds: number;
};

export async function getOverviewStats(dateRange: DateRangeInput): Promise<OverviewStats | null> {
  const result = await queryPlausible({
    metrics: ["visitors", "visits", "pageviews", "views_per_visit", "bounce_rate", "visit_duration"],
    date_range: dateRange,
  });
  const row = result?.results[0];
  if (!row) return null;
  const [visitors, visits, pageviews, viewsPerVisit, bounceRate, visitDurationSeconds] = row.metrics as number[];
  return { visitors, visits, pageviews, viewsPerVisit, bounceRate, visitDurationSeconds };
}

export type TimeseriesPoint = { date: string; visitors: number; pageviews: number };

export type TimeGranularity = "day" | "week" | "month";

export async function getTimeseries(
  dateRange: DateRangeInput,
  granularity: TimeGranularity = "day",
): Promise<TimeseriesPoint[] | null> {
  const result = await queryPlausible({
    metrics: ["visitors", "pageviews"],
    date_range: dateRange,
    dimensions: [`time:${granularity}`],
  });
  if (!result) return null;
  return result.results.map((row) => ({
    date: row.dimensions[0],
    visitors: row.metrics[0] as number,
    pageviews: row.metrics[1] as number,
  }));
}

export type BreakdownRow = { label: string; visitors: number };

async function getBreakdown(
  dateRange: DateRangeInput,
  dimension: string,
  limit = 10,
): Promise<BreakdownRow[] | null> {
  const result = await queryPlausible({
    metrics: ["visitors"],
    date_range: dateRange,
    dimensions: [dimension],
    order_by: [["visitors", "desc"]],
    pagination: { limit },
  });
  if (!result) return null;
  return result.results.map((row) => ({ label: row.dimensions[0] || "(none)", visitors: row.metrics[0] as number }));
}

export function getTopPages(dateRange: DateRangeInput, limit = 10) {
  return getBreakdown(dateRange, "event:page", limit);
}

export function getLandingPages(dateRange: DateRangeInput, limit = 10) {
  return getBreakdown(dateRange, "visit:entry_page", limit);
}

export function getExitPages(dateRange: DateRangeInput, limit = 10) {
  return getBreakdown(dateRange, "visit:exit_page", limit);
}

export function getTrafficSources(dateRange: DateRangeInput, limit = 10) {
  return getBreakdown(dateRange, "visit:source", limit);
}

export function getChannels(dateRange: DateRangeInput, limit = 10) {
  return getBreakdown(dateRange, "visit:channel", limit);
}

export function getDeviceBreakdown(dateRange: DateRangeInput) {
  return getBreakdown(dateRange, "visit:device", 10);
}

export function getBrowserBreakdown(dateRange: DateRangeInput, limit = 8) {
  return getBreakdown(dateRange, "visit:browser", limit);
}

export function getOsBreakdown(dateRange: DateRangeInput, limit = 8) {
  return getBreakdown(dateRange, "visit:os", limit);
}

export function getCountryBreakdown(dateRange: DateRangeInput, limit = 10) {
  return getBreakdown(dateRange, "visit:country_name", limit);
}

// Region/state-level geography, per the spec's "region/county where
// sufficiently reliable" ask. Plausible's own geo hierarchy stops at
// region (e.g. US states, admin-1 equivalents) -- it doesn't resolve to
// Kenyan counties specifically, so this is the finest legitimate
// granularity the Stats API actually offers; sparse/low-traffic regions
// will simply return few or no rows rather than fabricated county names.
export function getRegionBreakdown(dateRange: DateRangeInput, limit = 10) {
  return getBreakdown(dateRange, "visit:region_name", limit);
}

export type UtmCampaignRow = {
  source: string;
  medium: string;
  campaign: string;
  content: string;
  visitors: number;
};

// UTM breakdown, grouped by all four dimensions together (source, medium,
// campaign, and content) so a single campaign's rows aren't scattered
// across separate tables -- this is what answers "which campaigns actually
// generate traffic", per the spec, rather than disconnected lists.
// visit:utm_content is included per spec (ad/creative variant within a
// campaign, e.g. distinguishing two banner designs in the same campaign).
export async function getUtmCampaigns(dateRange: DateRangeInput, limit = 15): Promise<UtmCampaignRow[] | null> {
  const result = await queryPlausible({
    metrics: ["visitors"],
    date_range: dateRange,
    dimensions: ["visit:utm_source", "visit:utm_medium", "visit:utm_campaign", "visit:utm_content"],
    filters: [["is_not", "visit:utm_source", [""]]],
    order_by: [["visitors", "desc"]],
    pagination: { limit },
  });
  if (!result) return null;
  return result.results.map((row) => ({
    source: row.dimensions[0] || "(none)",
    medium: row.dimensions[1] || "(none)",
    campaign: row.dimensions[2] || "(none)",
    content: row.dimensions[3] || "(none)",
    visitors: row.metrics[0] as number,
  }));
}

export type GoalRow = { goal: string; events: number; visitors: number };

// Custom-event/CTA breakdown (Book a Demo clicks, WhatsApp clicks, Email
// clicks, Demo Form Started, Demo Request Submitted). Requires each event
// name to be configured as a Goal in the Plausible site's settings first --
// events fire regardless (see src/components/marketing/analytics.tsx), but
// the Stats API can only break them down by event:goal once a matching
// Goal exists. Returns an empty array (not null) if Plausible is
// configured but no goals have been set up yet, so the caller can tell
// "not connected" apart from "connected, but no goals configured".
export async function getGoalBreakdown(dateRange: DateRangeInput): Promise<GoalRow[] | null> {
  const result = await queryPlausible({
    metrics: ["events", "visitors"],
    date_range: dateRange,
    dimensions: ["event:goal"],
    order_by: [["events", "desc"]],
  });
  if (!result) return null;
  return result.results
    .filter((row) => row.dimensions[0])
    .map((row) => ({ goal: row.dimensions[0], events: row.metrics[0] as number, visitors: row.metrics[1] as number }));
}

// "Lightweight real-time view", per the spec: a single active-visitors
// count via the (still-supported) v1 realtime endpoint, not a full v2
// query -- deliberately not building a live visitor list/feed. See the
// admin analytics page for the reasoning on why this stays minimal.
export async function getRealtimeVisitorCount(): Promise<number | null> {
  if (!SITE_ID || !API_KEY) return null;
  try {
    const res = await fetch(
      `${API_BASE_URL}/api/v1/stats/realtime/visitors?site_id=${encodeURIComponent(SITE_ID)}`,
      { headers: { Authorization: `Bearer ${API_KEY}` }, next: { revalidate: 30 } },
    );
    if (!res.ok) return null;
    const value = await res.json();
    return typeof value === "number" ? value : null;
  } catch {
    return null;
  }
}
