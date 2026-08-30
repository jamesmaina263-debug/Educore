// Server-side client for the Google Analytics Data API (GA4), REST v1beta.
// Deliberately hand-rolled with google-auth-library + fetch rather than the
// @google-analytics/data SDK -- that package pulls in grpc-js/protobufjs,
// which is heavy for a Vercel serverless function and unnecessary here since
// the REST surface is small. Mirrors the same "safe no-op until configured"
// posture as src/lib/plausible.ts: every exported function returns null on
// any configuration gap, auth failure, or non-2xx response, never a
// fabricated zero. Callers render an explicit "not connected" state for a
// null result -- see src/components/admin/analytics/not-connected-card.tsx.
//
// KNOWN GAPS vs. the Plausible-shaped dashboard this replaces (see chat/PR
// notes -- flagged deliberately rather than silently faked):
//   - Exit pages: GA4 has no native exit-page dimension (a UA concept that
//     wasn't carried over). getExitPages() always returns null.
//   - Goal/CTA breakdown: the named events Plausible tracked (Contact CTA
//     Click, WhatsApp CTA Click, etc. -- see src/components/marketing/
//     analytics.tsx) are Plausible-specific and are NOT guaranteed to reach
//     GA4. getGoalBreakdown() reports GA4's actual top event names instead
//     of assuming those five exist; it will only show the demo-funnel-style
//     names if GTM (GTM-MGV2XHBB, see src/app/layout.tsx) has separately
//     been configured to fire matching events.
//   - UTM breakdown drops the "content" (ad variant) column present in the
//     Plausible version -- its GA4 dimension name wasn't confirmed against
//     current API docs, and guessing wrong breaks the entire report call
//     (GA4 errors the whole request on one bad field, unlike Plausible).

import { GoogleAuth } from "google-auth-library";

const PROPERTY_ID = process.env.GA4_PROPERTY_ID;
const SERVICE_ACCOUNT_JSON = process.env.GOOGLE_SERVICE_ACCOUNT_JSON;
const API_BASE_URL = "https://analyticsdata.googleapis.com/v1beta";

export function isGa4Configured(): boolean {
  return Boolean(PROPERTY_ID && SERVICE_ACCOUNT_JSON);
}

// [startDate, endDate] as "YYYY-MM-DD" -- callers (the admin analytics page)
// already compute real ISO dates for every period via
// src/lib/analytics-date-range.ts's startIso/endIso, so unlike Plausible's
// DateRangeInput this never needs a shorthand like "7d".
export type GaDateRangeInput = [string, string];

let cachedAuth: GoogleAuth | null = null;

function getAuthClient(): GoogleAuth | null {
  if (!SERVICE_ACCOUNT_JSON) return null;
  if (cachedAuth) return cachedAuth;
  try {
    const credentials = JSON.parse(SERVICE_ACCOUNT_JSON);
    cachedAuth = new GoogleAuth({
      credentials,
      scopes: ["https://www.googleapis.com/auth/analytics.readonly"],
    });
    return cachedAuth;
  } catch (err) {
    console.error("Failed to parse GOOGLE_SERVICE_ACCOUNT_JSON", err);
    return null;
  }
}

async function getAccessToken(): Promise<string | null> {
  const auth = getAuthClient();
  if (!auth) return null;
  try {
    const client = await auth.getClient();
    const { token } = await client.getAccessToken();
    return token ?? null;
  } catch (err) {
    console.error("GA4 auth failed", err);
    return null;
  }
}

type Ga4MetricValue = { value: string };
type Ga4DimensionValue = { value: string };
type Ga4Row = { dimensionValues?: Ga4DimensionValue[]; metricValues?: Ga4MetricValue[] };
type Ga4ReportResponse = { rows?: Ga4Row[]; totals?: Ga4Row[] };

// Every caller goes through here. Returns null on any configuration gap,
// auth failure, network failure, or non-2xx response -- same contract as
// Plausible's queryPlausible.
async function runReport(body: Record<string, unknown>): Promise<Ga4ReportResponse | null> {
  if (!PROPERTY_ID) return null;
  const token = await getAccessToken();
  if (!token) return null;

  try {
    const res = await fetch(`${API_BASE_URL}/properties/${PROPERTY_ID}:runReport`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
      // Same staleness tolerance as Plausible -- an admin dashboard doesn't
      // need second-by-second numbers, and this avoids hammering GA4's
      // Data API quota if the page or its date-range tabs are hit
      // repeatedly.
      next: { revalidate: 300 },
    });
    if (!res.ok) {
      console.error(`GA4 runReport failed: ${res.status} ${await res.text()}`);
      return null;
    }
    return (await res.json()) as Ga4ReportResponse;
  } catch (err) {
    console.error("GA4 runReport threw", err);
    return null;
  }
}

function toDateRange([startDate, endDate]: GaDateRangeInput) {
  return [{ startDate, endDate }];
}

export type OverviewStats = {
  visitors: number;
  visits: number;
  pageviews: number;
  viewsPerVisit: number;
  bounceRate: number;
  visitDurationSeconds: number;
};

export async function getOverviewStats(dateRange: GaDateRangeInput): Promise<OverviewStats | null> {
  const result = await runReport({
    dateRanges: toDateRange(dateRange),
    metrics: [
      { name: "totalUsers" },
      { name: "sessions" },
      { name: "screenPageViews" },
      { name: "screenPageViewsPerSession" },
      { name: "bounceRate" },
      { name: "averageSessionDuration" },
    ],
  });
  const row = result?.totals?.[0];
  const values = row?.metricValues;
  if (!values || values.length < 6) return null;
  return {
    visitors: Number(values[0].value),
    visits: Number(values[1].value),
    pageviews: Number(values[2].value),
    viewsPerVisit: Number(values[3].value),
    // GA4's bounceRate metric is a 0-1 fraction; the dashboard's KpiCard
    // formats this as `${bounceRate.toFixed(1)}%`, so normalize to a
    // percentage here to match what the Plausible client returned.
    bounceRate: Number(values[4].value) * 100,
    visitDurationSeconds: Number(values[5].value),
  };
}

export type TimeseriesPoint = { date: string; visitors: number; pageviews: number };
export type TimeGranularity = "day" | "week" | "month";

const GRANULARITY_DIMENSION: Record<TimeGranularity, string> = {
  day: "date",
  week: "yearWeek",
  month: "yearMonth",
};

// Formats GA4's raw dimension value ("20260830", "202635", "202608") into a
// readable label. Best-effort for week/month -- GA4 doesn't return a
// calendar-week start date directly, so "202635" is shown as "2026-W35"
// rather than resolved to a specific day.
function formatPeriodLabel(raw: string, granularity: TimeGranularity): string {
  if (granularity === "day" && /^\d{8}$/.test(raw)) {
    return `${raw.slice(0, 4)}-${raw.slice(4, 6)}-${raw.slice(6, 8)}`;
  }
  if (granularity === "month" && /^\d{6}$/.test(raw)) {
    return `${raw.slice(0, 4)}-${raw.slice(4, 6)}`;
  }
  if (granularity === "week" && /^\d{6}$/.test(raw)) {
    return `${raw.slice(0, 4)}-W${raw.slice(4, 6)}`;
  }
  return raw;
}

export async function getTimeseries(
  dateRange: GaDateRangeInput,
  granularity: TimeGranularity = "day",
): Promise<TimeseriesPoint[] | null> {
  const result = await runReport({
    dateRanges: toDateRange(dateRange),
    dimensions: [{ name: GRANULARITY_DIMENSION[granularity] }],
    metrics: [{ name: "totalUsers" }, { name: "screenPageViews" }],
    orderBys: [{ dimension: { dimensionName: GRANULARITY_DIMENSION[granularity] } }],
  });
  if (!result?.rows) return null;
  return result.rows.map((row) => ({
    date: formatPeriodLabel(row.dimensionValues?.[0]?.value ?? "", granularity),
    visitors: Number(row.metricValues?.[0]?.value ?? 0),
    pageviews: Number(row.metricValues?.[1]?.value ?? 0),
  }));
}

export type BreakdownRow = { label: string; visitors: number };

async function getBreakdown(
  dateRange: GaDateRangeInput,
  dimension: string,
  limit = 10,
): Promise<BreakdownRow[] | null> {
  const result = await runReport({
    dateRanges: toDateRange(dateRange),
    dimensions: [{ name: dimension }],
    metrics: [{ name: "totalUsers" }],
    orderBys: [{ metric: { metricName: "totalUsers" }, desc: true }],
    limit,
  });
  if (!result?.rows) return null;
  return result.rows.map((row) => ({
    label: row.dimensionValues?.[0]?.value || "(none)",
    visitors: Number(row.metricValues?.[0]?.value ?? 0),
  }));
}

export function getTopPages(dateRange: GaDateRangeInput, limit = 10) {
  return getBreakdown(dateRange, "pagePath", limit);
}

export function getLandingPages(dateRange: GaDateRangeInput, limit = 10) {
  return getBreakdown(dateRange, "landingPage", limit);
}

// No GA4 equivalent -- see the module-level note. Kept as a function (rather
// than removed) so the admin analytics page's call site doesn't need an
// extra conditional; it just renders an empty "Exit pages" list.
export async function getExitPages(_dateRange: GaDateRangeInput, _limit = 10): Promise<BreakdownRow[] | null> {
  return null;
}

export function getTrafficSources(dateRange: GaDateRangeInput, limit = 10) {
  return getBreakdown(dateRange, "sessionSource", limit);
}

export function getChannels(dateRange: GaDateRangeInput, limit = 10) {
  return getBreakdown(dateRange, "sessionDefaultChannelGroup", limit);
}

export function getDeviceBreakdown(dateRange: GaDateRangeInput) {
  return getBreakdown(dateRange, "deviceCategory", 10);
}

export function getBrowserBreakdown(dateRange: GaDateRangeInput, limit = 8) {
  return getBreakdown(dateRange, "browser", limit);
}

export function getOsBreakdown(dateRange: GaDateRangeInput, limit = 8) {
  return getBreakdown(dateRange, "operatingSystem", limit);
}

export function getCountryBreakdown(dateRange: GaDateRangeInput, limit = 10) {
  return getBreakdown(dateRange, "country", limit);
}

export function getRegionBreakdown(dateRange: GaDateRangeInput, limit = 10) {
  return getBreakdown(dateRange, "region", limit);
}

export type UtmCampaignRow = {
  source: string;
  medium: string;
  campaign: string;
  content: string;
  visitors: number;
};

// "content" is always "(none)" here -- see module-level note on why the ad-
// variant dimension was deliberately left out rather than guessed.
export async function getUtmCampaigns(dateRange: GaDateRangeInput, limit = 15): Promise<UtmCampaignRow[] | null> {
  const result = await runReport({
    dateRanges: toDateRange(dateRange),
    dimensions: [{ name: "sessionSource" }, { name: "sessionMedium" }, { name: "sessionCampaignName" }],
    metrics: [{ name: "totalUsers" }],
    orderBys: [{ metric: { metricName: "totalUsers" }, desc: true }],
    limit,
  });
  if (!result?.rows) return null;
  return result.rows.map((row) => ({
    source: row.dimensionValues?.[0]?.value || "(none)",
    medium: row.dimensionValues?.[1]?.value || "(none)",
    campaign: row.dimensionValues?.[2]?.value || "(none)",
    content: "(none)",
    visitors: Number(row.metricValues?.[0]?.value ?? 0),
  }));
}

export type GoalRow = { goal: string; events: number; visitors: number };

// Reports GA4's actual top event names, NOT a filtered Plausible-style goal
// list -- see the module-level note on why those two things aren't the same
// data source. Rename in the UI from "Goal" to "Event" if this replaces the
// Plausible version, to avoid implying these are configured Goals.
export async function getGoalBreakdown(dateRange: GaDateRangeInput): Promise<GoalRow[] | null> {
  const result = await runReport({
    dateRanges: toDateRange(dateRange),
    dimensions: [{ name: "eventName" }],
    metrics: [{ name: "eventCount" }, { name: "totalUsers" }],
    orderBys: [{ metric: { metricName: "eventCount" }, desc: true }],
    limit: 15,
  });
  if (!result?.rows) return null;
  return result.rows
    .filter((row) => row.dimensionValues?.[0]?.value)
    .map((row) => ({
      goal: row.dimensionValues![0].value,
      events: Number(row.metricValues?.[0]?.value ?? 0),
      visitors: Number(row.metricValues?.[1]?.value ?? 0),
    }));
}

// GA4's separate Realtime API, mirroring the "lightweight active-visitors
// count" the admin page shows -- not a full realtime dimension breakdown.
export async function getRealtimeVisitorCount(): Promise<number | null> {
  if (!PROPERTY_ID) return null;
  const token = await getAccessToken();
  if (!token) return null;
  try {
    const res = await fetch(`${API_BASE_URL}/properties/${PROPERTY_ID}:runRealtimeReport`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ metrics: [{ name: "activeUsers" }] }),
      next: { revalidate: 30 },
    });
    if (!res.ok) return null;
    const data = (await res.json()) as Ga4ReportResponse;
    const value = data.rows?.[0]?.metricValues?.[0]?.value ?? data.totals?.[0]?.metricValues?.[0]?.value;
    return value !== undefined ? Number(value) : null;
  } catch {
    return null;
  }
}
