// Server-side client for the Google Analytics Data API (GA4), REST v1beta.
// Deliberately hand-rolled with google-auth-library + fetch rather than the
// @google-analytics/data SDK -- that package pulls in grpc-js/protobufjs,
// which is heavy for a Vercel serverless function and unnecessary here since
// the REST surface is small. Mirrors the same "safe no-op until configured"
// posture as before Plausible was removed (see MARKETING_SITE_STATUS.md's
// 2026-09-16 entry): every exported function returns null on
// any configuration gap, auth failure, or non-2xx response, never a
// fabricated zero. Callers render an explicit "not connected" state for a
// null result -- see src/components/admin/analytics/not-connected-card.tsx.
//
// KNOWN GAPS vs. the Plausible-shaped dashboard this replaces (see chat/PR
// notes -- flagged deliberately rather than silently faked):
//   - Exit pages: GA4 has no native exit-page dimension (a UA concept that
//     wasn't carried over). getExitPages() always returns null.
//   - Goal/CTA breakdown: getGoalBreakdown() reports GA4's actual top event
//     names rather than assuming any particular five exist. It will only
//     show demo-funnel-style names ("Demo Form Started", "Contact CTA
//     Click", etc. -- the funnel labels in src/app/(admin)/admin/analytics/
//     page.tsx) if GTM (GTM-MGV2XHBB, see src/app/(marketing)/layout.tsx)
//     has separately been configured to fire matching events. As of
//     2026-09-16 nothing sends those specific event names -- see
//     MARKETING_SITE_STATUS.md's entry from that date.
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

// Retries once on a transient network-level failure -- observed in production runtime errors
// on /admin/analytics (2026-09-18): `TypeError: fetch failed` wrapping a
// `SocketError: other side closed` / `UND_ERR_SOCKET` cause, from a handful of concurrent
// calls to Google's API per page load (this page fires ~16 GA4 requests via Promise.all).
// A reused keep-alive socket to googleapis.com occasionally gets closed server-side right as
// a new request tries to reuse it -- a transport-level hiccup, not a bad request or bad
// credentials, and it self-resolves on a fresh attempt. Only retries `TypeError` (what
// undici's fetch throws for a network-level failure); an HTTP error response is a resolved
// promise, not a throw, so it's unaffected and still handled by each caller's own !res.ok
// check. Never retries a second time -- if it fails again, the existing null-safe fallback
// (see file header) takes over exactly as before.
async function withNetworkRetry<T>(fn: () => Promise<T>): Promise<T> {
  try {
    return await fn();
  } catch (err) {
    if (!(err instanceof TypeError)) throw err;
    await new Promise((resolve) => setTimeout(resolve, 250));
    return fn();
  }
}

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
    const { token } = await withNetworkRetry(() => client.getAccessToken());
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

// Google's Data API enforces per-property quotas, including a cap on concurrent requests, and a
// 429 RESOURCE_EXHAUSTED when any bucket is empty. /admin/analytics fans out ~18 GA4 calls per
// render via Promise.all, so overlapping renders (tab clicks, prefetches, a stale 5-minute cache
// refreshing everything at once) can trip that. Three guards, all local to the standard
// runReport path: batching (below), a small in-process queue so only a few requests are in flight
// at a time, and a short exponential backoff on 429 as Google recommends. Anything still failing after that falls
// through to the existing null-safe behaviour.
const MAX_CONCURRENT_REPORTS = 4;
const MAX_429_RETRIES = 2; // 3 attempts in total
const RETRY_BASE_MS = 400; // waits ~400ms, then ~800ms, plus a little jitter

let activeReports = 0;
const reportWaiters: Array<() => void> = [];

async function withReportSlot<T>(fn: () => Promise<T>): Promise<T> {
  if (activeReports >= MAX_CONCURRENT_REPORTS) {
    // The slot is handed over directly by whoever finishes, so the count is not incremented here.
    await new Promise<void>((resolve) => reportWaiters.push(resolve));
  } else {
    activeReports++;
  }
  try {
    return await fn();
  } finally {
    const next = reportWaiters.shift();
    if (next) next();
    else activeReports--;
  }
}

async function fetchReportWithBackoff(url: string, init: RequestInit & { next?: { revalidate: number } }): Promise<Response> {
  for (let attempt = 0; ; attempt++) {
    // The slot covers one attempt only, so a backing-off call does not block the queue.
    const res = await withReportSlot(() => withNetworkRetry(() => fetch(url, init)));
    if (res.status !== 429 || attempt >= MAX_429_RETRIES) return res;
    const delay = RETRY_BASE_MS * 2 ** attempt + Math.floor(Math.random() * 100);
    await new Promise((resolve) => setTimeout(resolve, delay));
  }
}

// One standalone runReport request. Returns null on any configuration gap, auth failure, network
// failure, or non-2xx response -- never throws. Used directly for a lone report and as the
// per-report fallback when a batch is rejected (see sendBatch below).
async function runSingleReport(body: Record<string, unknown>): Promise<Ga4ReportResponse | null> {
  if (!PROPERTY_ID) return null;
  const token = await getAccessToken();
  if (!token) return null;

  try {
    const res = await fetchReportWithBackoff(`${API_BASE_URL}/properties/${PROPERTY_ID}:runReport`, {
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

// ---- batching -------------------------------------------------------------------------------
// The Data API counts each HTTP request against the property's concurrent-request quota, and
// /admin/analytics fires ~20 reports per render. batchRunReports accepts up to 5 reports in one
// request (one concurrent slot), so reports requested in the same tick are coalesced into batches
// instead of being sent one by one. Callers still just `await runReport(body)`.
//
// Two safeguards, because GA4 fails a whole batch if any single report in it is invalid (the same
// all-or-nothing behaviour noted in the file header):
//   - a non-429 failure of a batch falls back to sending its reports individually, so one bad
//     report can't blank the rest of the dashboard;
//   - a 429 is NOT retried individually (that would multiply the load on an exhausted quota);
//     fetchReportWithBackoff has already retried the batch, so its reports resolve to null.
const MAX_BATCH_SIZE = 5; // batchRunReports hard limit

type PendingReport = {
  body: Record<string, unknown>;
  key: string;
  resolve: (report: Ga4ReportResponse | null) => void;
};

let pendingReports: PendingReport[] = [];
let flushScheduled = false;

// Every caller goes through here. Returns null on any configuration gap, auth failure, network
// failure, or non-2xx response -- never throws.
function runReport(body: Record<string, unknown>): Promise<Ga4ReportResponse | null> {
  if (!isGa4Configured()) return Promise.resolve(null);
  return new Promise((resolve) => {
    pendingReports.push({ body, key: JSON.stringify(body), resolve });
    if (!flushScheduled) {
      flushScheduled = true;
      // A macrotask, so every report requested in this render's Promise.all is queued first.
      setTimeout(() => void flushPendingReports(), 0);
    }
  });
}

async function flushPendingReports(): Promise<void> {
  flushScheduled = false;
  const queued = pendingReports;
  pendingReports = [];
  // Sorted so the same set of reports always forms the same batch bodies, which keeps the
  // 5-minute fetch cache effective regardless of the order callers happened to arrive in.
  queued.sort((a, b) => (a.key < b.key ? -1 : a.key > b.key ? 1 : 0));

  const chunks: PendingReport[][] = [];
  for (let i = 0; i < queued.length; i += MAX_BATCH_SIZE) chunks.push(queued.slice(i, i + MAX_BATCH_SIZE));

  await Promise.all(
    chunks.map(async (chunk) => {
      try {
        if (chunk.length === 1) {
          chunk[0].resolve(await runSingleReport(chunk[0].body));
          return;
        }
        const token = await getAccessToken();
        if (!token) {
          for (const p of chunk) p.resolve(null);
          return;
        }
        await sendBatch(chunk, token);
      } catch (err) {
        console.error("GA4 report batch threw", err);
        for (const p of chunk) p.resolve(null);
      }
    }),
  );
}

async function sendBatch(chunk: PendingReport[], token: string): Promise<void> {
  try {
    const res = await fetchReportWithBackoff(`${API_BASE_URL}/properties/${PROPERTY_ID}:batchRunReports`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ requests: chunk.map((p) => p.body) }),
      next: { revalidate: 300 },
    });
    if (res.ok) {
      const data = (await res.json()) as { reports?: Ga4ReportResponse[] };
      const reports = data.reports;
      if (Array.isArray(reports) && reports.length === chunk.length) {
        chunk.forEach((p, i) => p.resolve(reports[i] ?? {}));
        return;
      }
      console.error("GA4 batchRunReports returned an unexpected shape; sending reports individually");
    } else if (res.status === 429) {
      console.error(`GA4 batchRunReports failed: ${res.status} ${await res.text()}`);
      for (const p of chunk) p.resolve(null);
      return;
    } else {
      console.error(`GA4 batchRunReports failed: ${res.status} ${await res.text()}; sending reports individually`);
    }
  } catch (err) {
    console.error("GA4 batchRunReports threw", err);
    for (const p of chunk) p.resolve(null);
    return;
  }
  // Isolation fallback: find out which report(s) GA4 actually objects to.
  await Promise.all(chunk.map(async (p) => p.resolve(await runSingleReport(p.body))));
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
    // GA4 only populates `totals` when explicitly asked for it. With no
    // dimensions in this request, `rows[0]` already holds the same
    // whole-period aggregate, so it's used as the fallback below in case a
    // future edit adds a dimension and `rows` becomes a real breakdown.
    metricAggregations: ["TOTAL"],
  });
  // null means the request itself failed (config, auth, network, non-2xx) -- the dashboard
  // renders that as "—". A successful response with no rows means GA4 has no data for the
  // period (e.g. a quiet or not-yet-processed "Today"), which is a real zero, not an error.
  if (!result) return null;
  const row = result.totals?.[0] ?? result.rows?.[0];
  const values = row?.metricValues;
  if (!values || values.length < 6) {
    return { visitors: 0, visits: 0, pageviews: 0, viewsPerVisit: 0, bounceRate: 0, visitDurationSeconds: 0 };
  }
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

// "Engaged Visitors" funnel stage. GA4 defines an engaged session
// automatically -- 10+ seconds of engagement time, 1+ conversion event, or
// 2+ page/screen views -- with no manual threshold to configure in the
// GA4 UI (that was a leftover assumption from Universal Analytics, which
// this dashboard replaced; UA's session-timeout setting doesn't carry
// over). `engagedSessions` is a standard Data API metric, so this needed
// no new GA4/GTM configuration, just wiring up the query.
//
// Note this counts engaged *sessions*, not unique engaged *users* -- GA4's
// Data API has no "engaged users" metric, only session-level engagement.
// Wired into the funnel as an honest session-count alongside the
// user-count stages above and below it; see the note passed at the call
// site in the analytics page.
export async function getEngagedVisitors(dateRange: GaDateRangeInput): Promise<number | null> {
  const result = await runReport({
    dateRanges: toDateRange(dateRange),
    metrics: [{ name: "engagedSessions" }],
    metricAggregations: ["TOTAL"],
  });
  // null = request failed; a successful response with no rows is a real 0 (see getOverviewStats).
  if (!result) return null;
  const row = result.totals?.[0] ?? result.rows?.[0];
  const value = row?.metricValues?.[0]?.value;
  if (value === undefined) return 0;
  return Number(value);
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
  // null = request failed; no rows on a successful response = no traffic in range.
  if (!result) return null;
  if (!result.rows) return [];
  return result.rows.map((row) => ({
    date: formatPeriodLabel(row.dimensionValues?.[0]?.value ?? "", granularity),
    visitors: Number(row.metricValues?.[0]?.value ?? 0),
    pageviews: Number(row.metricValues?.[1]?.value ?? 0),
  }));
}

export type BreakdownRow = { label: string; visitors: number };

// `engagedOnly` swaps the metric from `totalUsers` (every hit that fires the
// GA4 script, including single-pageview automated traffic that isn't on the
// declared-bots list GA4 filters by default) to `engagedSessions` (GA4's own
// engagement definition: 10s+ engaged, 2+ pageviews, or a conversion event --
// see getEngagedVisitors above). This doesn't require any new GA4/GTM
// configuration; engagedSessions is a standard Data API metric compatible
// with every dimension used here. It's an approximation, not a real bot
// filter -- a fast, disengaged real visitor and a sophisticated bot that
// fakes engagement both slip through either way -- but at current traffic
// volumes it's a cheap, honest signal for "was this likely a real visit."
async function getBreakdown(
  dateRange: GaDateRangeInput,
  dimension: string,
  limit = 10,
  engagedOnly = false,
): Promise<BreakdownRow[] | null> {
  const metricName = engagedOnly ? "engagedSessions" : "totalUsers";
  const result = await runReport({
    dateRanges: toDateRange(dateRange),
    dimensions: [{ name: dimension }],
    metrics: [{ name: metricName }],
    orderBys: [{ metric: { metricName }, desc: true }],
    limit,
  });
  // null = request failed; no rows on a successful response = nothing to list.
  if (!result) return null;
  if (!result.rows) return [];
  return result.rows.map((row) => ({
    label: row.dimensionValues?.[0]?.value || "(none)",
    visitors: Number(row.metricValues?.[0]?.value ?? 0),
  }));
}

export function getTopPages(dateRange: GaDateRangeInput, limit = 10, engagedOnly = false) {
  return getBreakdown(dateRange, "pagePath", limit, engagedOnly);
}

export function getLandingPages(dateRange: GaDateRangeInput, limit = 10, engagedOnly = false) {
  return getBreakdown(dateRange, "landingPage", limit, engagedOnly);
}

// No GA4 equivalent -- see the module-level note. Kept as a function (rather
// than removed) so the admin analytics page's call site doesn't need an
// extra conditional; it just renders an empty "Exit pages" list.
export async function getExitPages(_dateRange: GaDateRangeInput, _limit = 10): Promise<BreakdownRow[] | null> {
  return null;
}

export function getTrafficSources(dateRange: GaDateRangeInput, limit = 10, engagedOnly = false) {
  return getBreakdown(dateRange, "sessionSource", limit, engagedOnly);
}

export function getDeviceBreakdown(dateRange: GaDateRangeInput, engagedOnly = false) {
  return getBreakdown(dateRange, "deviceCategory", 10, engagedOnly);
}

export function getBrowserBreakdown(dateRange: GaDateRangeInput, limit = 8, engagedOnly = false) {
  return getBreakdown(dateRange, "browser", limit, engagedOnly);
}

export function getOsBreakdown(dateRange: GaDateRangeInput, limit = 8, engagedOnly = false) {
  return getBreakdown(dateRange, "operatingSystem", limit, engagedOnly);
}

export function getCountryBreakdown(dateRange: GaDateRangeInput, limit = 10, engagedOnly = false) {
  return getBreakdown(dateRange, "country", limit, engagedOnly);
}

export function getRegionBreakdown(dateRange: GaDateRangeInput, limit = 10, engagedOnly = false) {
  return getBreakdown(dateRange, "region", limit, engagedOnly);
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
export async function getUtmCampaigns(
  dateRange: GaDateRangeInput,
  limit = 15,
  engagedOnly = false,
): Promise<UtmCampaignRow[] | null> {
  const metricName = engagedOnly ? "engagedSessions" : "totalUsers";
  const result = await runReport({
    dateRanges: toDateRange(dateRange),
    dimensions: [{ name: "sessionSource" }, { name: "sessionMedium" }, { name: "sessionCampaignName" }],
    metrics: [{ name: metricName }],
    orderBys: [{ metric: { metricName }, desc: true }],
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

export type KeyEventSeriesPoint = { date: string; counts: Record<string, number> };

// Time series for specific named GA4 events (e.g. "sign_up", "Demo Request
// Submitted") -- distinct from getGoalBreakdown()'s single-period totals,
// this tracks how each named event trends day-by-day so a spike or
// drop-off is visible rather than buried in one summed number. Events only
// appear once GA4 has actually received them; an event with zero rows in
// range simply contributes 0 for every date, same posture as the rest of
// this file's "never fabricate a value" rule.
export async function getKeyEventsTimeseries(
  dateRange: GaDateRangeInput,
  eventNames: string[],
  granularity: TimeGranularity = "day",
): Promise<KeyEventSeriesPoint[] | null> {
  if (eventNames.length === 0) return [];
  const result = await runReport({
    dateRanges: toDateRange(dateRange),
    dimensions: [{ name: GRANULARITY_DIMENSION[granularity] }, { name: "eventName" }],
    metrics: [{ name: "eventCount" }],
    dimensionFilter: {
      filter: { fieldName: "eventName", inListFilter: { values: eventNames } },
    },
    orderBys: [{ dimension: { dimensionName: GRANULARITY_DIMENSION[granularity] } }],
    limit: 1000,
  });
  if (!result) return null;
  if (!result.rows) return [];
  const byDate = new Map<string, Record<string, number>>();
  for (const row of result.rows) {
    const eventName = row.dimensionValues?.[1]?.value;
    if (!eventName) continue;
    const label = formatPeriodLabel(row.dimensionValues?.[0]?.value ?? "", granularity);
    const count = Number(row.metricValues?.[0]?.value ?? 0);
    const existing = byDate.get(label) ?? {};
    existing[eventName] = (existing[eventName] ?? 0) + count;
    byDate.set(label, existing);
  }
  return Array.from(byDate.entries())
    .map(([date, counts]) => ({ date, counts }))
    .sort((a, b) => a.date.localeCompare(b.date));
}

export type ChannelPerformanceRow = { label: string; sessions: number; engagementRate: number };

// Channel-level session volume paired with GA4's engagement rate -- a
// quality signal alongside the other visitor-count breakdowns on this
// page (which report totalUsers/engagedSessions). engagementRate comes back from GA4 as a 0-1 fraction;
// converted to a 0-100 percentage here so callers never re-derive it.
export async function getChannelPerformance(
  dateRange: GaDateRangeInput,
  limit = 10,
): Promise<ChannelPerformanceRow[] | null> {
  const result = await runReport({
    dateRanges: toDateRange(dateRange),
    dimensions: [{ name: "sessionDefaultChannelGroup" }],
    metrics: [{ name: "sessions" }, { name: "engagementRate" }],
    orderBys: [{ metric: { metricName: "sessions" }, desc: true }],
    limit,
  });
  if (!result) return null;
  if (!result.rows) return [];
  return result.rows.map((row) => ({
    label: row.dimensionValues?.[0]?.value || "(none)",
    sessions: Number(row.metricValues?.[0]?.value ?? 0),
    engagementRate: Number(row.metricValues?.[1]?.value ?? 0) * 100,
  }));
}

// GA4's separate Realtime API, mirroring the "lightweight active-visitors
// count" the admin page shows -- not a full realtime dimension breakdown.
export async function getRealtimeVisitorCount(): Promise<number | null> {
  if (!PROPERTY_ID) return null;
  const token = await getAccessToken();
  if (!token) return null;
  try {
    const res = await withNetworkRetry(() =>
      fetch(`${API_BASE_URL}/properties/${PROPERTY_ID}:runRealtimeReport`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ metrics: [{ name: "activeUsers" }] }),
        next: { revalidate: 30 },
      }),
    );
    if (!res.ok) {
      console.error(`GA4 runRealtimeReport failed: ${res.status} ${await res.text()}`);
      return null;
    }
    const data = (await res.json()) as Ga4ReportResponse;
    const value = data.rows?.[0]?.metricValues?.[0]?.value ?? data.totals?.[0]?.metricValues?.[0]?.value;
    // GA4's Realtime API omits `rows` entirely when nobody has been active in the window, so a
    // successful response with no rows is a real zero. Returning null here hid the whole
    // "active visitors" line whenever the site was quiet, indistinguishable from a failure.
    return value !== undefined ? Number(value) : 0;
  } catch (err) {
    console.error("GA4 runRealtimeReport threw", err);
    return null;
  }
}

// ---- Live ("right now") snapshot -------------------------------------------------------------
// The standard Data API (every other function in this file) is processed in batches and can lag
// by hours, so a visitor who is on the site this minute can be missing from "Today" until GA4
// catches up. The Realtime API is the only GA4 source that reflects the last ~30 minutes, so the
// live panel on /admin/analytics is built entirely from it and is polled from the browser.
// Never fabricates: a failed call yields null (panel shows an error), an empty response is a
// genuine zero (the Realtime API omits `rows` when nobody is active).

export type RealtimeSnapshot = {
  activeUsers: number;
  pageViews: number;
  /** Active users per minute, index 0 = this minute, index 29 = 29 minutes ago. */
  perMinute: number[];
  topPages: { label: string; value: number }[];
  locations: { label: string; value: number }[];
  devices: { label: string; value: number }[];
  events: { label: string; value: number }[];
  fetchedAt: string;
  /** True when Google refused the latest refresh and this is the last good reading, not a new one. */
  stale?: boolean;
};

// Same auth and error posture as runReport, but uncached: a live panel that serves a cached
// response would just move the "why does it say zero" problem somewhere else. `rateLimited`
// distinguishes Google's 429 (back off and keep showing the last reading) from any other failure.
async function runRealtimeReport(
  body: Record<string, unknown>,
): Promise<{ report: Ga4ReportResponse | null; rateLimited: boolean }> {
  if (!PROPERTY_ID) return { report: null, rateLimited: false };
  const token = await getAccessToken();
  if (!token) return { report: null, rateLimited: false };
  try {
    const res = await withNetworkRetry(() =>
      fetch(`${API_BASE_URL}/properties/${PROPERTY_ID}:runRealtimeReport`, {
        method: "POST",
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        body: JSON.stringify(body),
        cache: "no-store",
      }),
    );
    if (!res.ok) {
      console.error(`GA4 runRealtimeReport failed: ${res.status} ${await res.text()}`);
      return { report: null, rateLimited: res.status === 429 };
    }
    return { report: (await res.json()) as Ga4ReportResponse, rateLimited: false };
  } catch (err) {
    console.error("GA4 runRealtimeReport threw", err);
    return { report: null, rateLimited: false };
  }
}

function realtimeRows(
  report: Ga4ReportResponse | null,
): { dims: string[]; metrics: number[] }[] {
  return (report?.rows ?? []).map((row) => ({
    dims: (row.dimensionValues ?? []).map((d) => d.value),
    metrics: (row.metricValues ?? []).map((m) => Number(m.value)),
  }));
}

// Google allows only ~10 simultaneous Realtime requests per property, and an admin page load plus
// a few open tabs (each refreshing every 30s, each making 5 calls) can exceed that, so Google
// answers 429. To stay well inside the limit the snapshot is built from one call at a time, kept
// for SNAPSHOT_TTL_MS and shared by every caller on this server instance (concurrent callers wait
// on the same in-flight build), and after a 429 no new calls are made for a cool-down while the
// last good reading keeps being served, marked stale.
const SNAPSHOT_TTL_MS = 20_000;
const RATE_LIMIT_COOLDOWN_MS = 60_000;
const STALE_MAX_AGE_MS = 5 * 60_000;

let snapshotCache: { snapshot: RealtimeSnapshot; at: number } | null = null;
let snapshotInFlight: Promise<RealtimeSnapshot | null> | null = null;
let rateLimitedUntil = 0;

function lastGoodSnapshot(now: number): RealtimeSnapshot | null {
  if (!snapshotCache || now - snapshotCache.at >= STALE_MAX_AGE_MS) return null;
  return { ...snapshotCache.snapshot, stale: true };
}

async function buildRealtimeSnapshot(): Promise<{ snapshot: RealtimeSnapshot | null; rateLimited: boolean }> {
  // TOTAL on the device call is GA4's de-duplicated unique-user count -- summing the per-minute or
  // per-page rows would double count anyone who browsed more than one page. It goes first because
  // the panel has nothing honest to show without it.
  const requests: Record<string, unknown>[] = [
    {
      dimensions: [{ name: "deviceCategory" }],
      metrics: [{ name: "activeUsers" }],
      metricAggregations: ["TOTAL"],
      orderBys: [{ metric: { metricName: "activeUsers" }, desc: true }],
    },
    {
      dimensions: [{ name: "unifiedScreenName" }],
      metrics: [{ name: "activeUsers" }, { name: "screenPageViews" }],
      metricAggregations: ["TOTAL"],
      orderBys: [{ metric: { metricName: "screenPageViews" }, desc: true }],
      limit: 8,
    },
    { dimensions: [{ name: "minutesAgo" }], metrics: [{ name: "activeUsers" }] },
    {
      dimensions: [{ name: "country" }, { name: "city" }],
      metrics: [{ name: "activeUsers" }],
      orderBys: [{ metric: { metricName: "activeUsers" }, desc: true }],
      limit: 8,
    },
    {
      dimensions: [{ name: "eventName" }],
      metrics: [{ name: "eventCount" }],
      orderBys: [{ metric: { metricName: "eventCount" }, desc: true }],
      limit: 8,
    },
  ];

  const reports: (Ga4ReportResponse | null)[] = [];
  for (const body of requests) {
    const { report, rateLimited } = await runRealtimeReport(body);
    // Stop at the first 429 rather than piling more requests onto an exhausted quota.
    if (rateLimited) return { snapshot: null, rateLimited: true };
    reports.push(report);
  }
  const [devices, pages, minutes, places, events] = reports;
  if (!devices) return { snapshot: null, rateLimited: false };

  const activeUsers = Number(devices.totals?.[0]?.metricValues?.[0]?.value ?? 0);
  const pageViews = Number(pages?.totals?.[0]?.metricValues?.[1]?.value ?? 0);

  const perMinute = Array.from({ length: 30 }, () => 0);
  for (const { dims, metrics } of realtimeRows(minutes)) {
    const idx = Number(dims[0]);
    if (Number.isInteger(idx) && idx >= 0 && idx < 30) perMinute[idx] = metrics[0] ?? 0;
  }

  return {
    rateLimited: false,
    snapshot: {
      activeUsers,
      pageViews,
      perMinute,
      topPages: realtimeRows(pages).map(({ dims, metrics }) => ({
        label: dims[0] || "(untitled)",
        value: metrics[1] ?? 0,
      })),
      locations: realtimeRows(places).map(({ dims, metrics }) => ({
        label: formatLocation(dims[1], dims[0]),
        value: metrics[0] ?? 0,
      })),
      devices: realtimeRows(devices).map(({ dims, metrics }) => ({
        label: dims[0] || "(unknown)",
        value: metrics[0] ?? 0,
      })),
      events: realtimeRows(events).map(({ dims, metrics }) => ({
        label: dims[0] || "(none)",
        value: metrics[0] ?? 0,
      })),
      fetchedAt: new Date().toISOString(),
    },
  };
}

export async function getRealtimeSnapshot(): Promise<RealtimeSnapshot | null> {
  if (!PROPERTY_ID) return null;
  const now = Date.now();
  if (snapshotCache && now - snapshotCache.at < SNAPSHOT_TTL_MS) return snapshotCache.snapshot;
  if (now < rateLimitedUntil) return lastGoodSnapshot(now);
  if (snapshotInFlight) return snapshotInFlight;

  snapshotInFlight = buildRealtimeSnapshot()
    .then(({ snapshot, rateLimited }) => {
      if (snapshot) {
        snapshotCache = { snapshot, at: Date.now() };
        return snapshot;
      }
      if (rateLimited) rateLimitedUntil = Date.now() + RATE_LIMIT_COOLDOWN_MS;
      return lastGoodSnapshot(Date.now());
    })
    .finally(() => {
      snapshotInFlight = null;
    });
  return snapshotInFlight;
}

export type FunnelDetailRow = {
  source: string;
  page: string;
  device: string;
  location: string;
  eventName?: string;
  ctaLabel?: string;
  ctaLocation?: string;
  count: number;
};

function formatLocation(city: string | undefined, country: string | undefined): string {
  const c = city && city !== "(not set)" ? city : "";
  const k = country && country !== "(not set)" ? country : "";
  return [c, k].filter(Boolean).join(", ") || "(unknown)";
}

// Row-level drill-down behind the funnel's "Engaged Visitors" stage: each row is a
// distinct source / landing page / device / city combination with its engaged-session
// count. Anonymous by design -- GA4 never exposes a person, only aggregates.
export async function getEngagedSessionDetail(
  dateRange: GaDateRangeInput,
  limit = 25,
): Promise<FunnelDetailRow[] | null> {
  const result = await runReport({
    dateRanges: toDateRange(dateRange),
    dimensions: [
      { name: "sessionSource" },
      { name: "sessionMedium" },
      { name: "landingPage" },
      { name: "deviceCategory" },
      { name: "city" },
      { name: "country" },
    ],
    metrics: [{ name: "engagedSessions" }],
    metricFilter: {
      filter: { fieldName: "engagedSessions", numericFilter: { operation: "GREATER_THAN", value: { int64Value: "0" } } },
    },
    orderBys: [{ metric: { metricName: "engagedSessions" }, desc: true }],
    limit,
  });
  if (!result?.rows) return result ? [] : null;
  return result.rows.map((row) => {
    const d = row.dimensionValues ?? [];
    return {
      source: `${d[0]?.value || "(none)"} / ${d[1]?.value || "(none)"}`,
      page: d[2]?.value || "(none)",
      device: d[3]?.value || "(none)",
      location: formatLocation(d[4]?.value, d[5]?.value),
      count: Number(row.metricValues?.[0]?.value ?? 0),
    };
  });
}

// Row-level drill-down behind the funnel's "CTA Clicks" stage. Matches the same events the
// stage sums (every event name containing "CTA": Contact/Trial/WhatsApp/Email CTA Click),
// broken down by which button was clicked (cta_label/cta_location custom dimensions, sent
// on every CTA Click event via GTM) plus the page it happened on and device.
export async function getCtaClickDetail(
  dateRange: GaDateRangeInput,
  limit = 25,
): Promise<FunnelDetailRow[] | null> {
  const result = await runReport({
    dateRanges: toDateRange(dateRange),
    dimensions: [
      { name: "eventName" },
      { name: "customEvent:cta_label" },
      { name: "customEvent:cta_location" },
      { name: "pagePath" },
      { name: "deviceCategory" },
    ],
    metrics: [{ name: "eventCount" }],
    dimensionFilter: {
      filter: { fieldName: "eventName", stringFilter: { matchType: "CONTAINS", value: "CTA" } },
    },
    orderBys: [{ metric: { metricName: "eventCount" }, desc: true }],
    limit,
  });
  if (!result?.rows) return result ? [] : null;
  return result.rows.map((row) => {
    const d = row.dimensionValues ?? [];
    return {
      eventName: d[0]?.value || "(none)",
      ctaLabel: d[1]?.value || "(not set)",
      ctaLocation: d[2]?.value || "(not set)",
      page: d[3]?.value || "(none)",
      device: d[4]?.value || "(none)",
      source: "",
      location: "",
      count: Number(row.metricValues?.[0]?.value ?? 0),
    };
  });
}
