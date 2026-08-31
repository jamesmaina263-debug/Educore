// Server-side client for the Google Search Console API (searchAnalytics.query,
// webmasters/v3). Mirrors src/lib/ga4.ts: hand-rolled with google-auth-library
// + fetch rather than the googleapis SDK, for the same reason (small REST
// surface, avoid a heavy dependency for one endpoint). Same "safe no-op until
// configured" posture -- every exported function returns null on any
// configuration gap, auth failure, or non-2xx response, never a fabricated
// zero. Callers render an explicit "not connected" state for a null result --
// see src/components/admin/analytics/not-connected-card.tsx.
//
// Reuses the same service account as ga4.ts (educore-ga4-reader@educore-
// analytics.iam.gserviceaccount.com, GOOGLE_SERVICE_ACCOUNT_JSON) -- it was
// added as a Restricted user on the Search Console property specifically so
// no second credential is needed. Auth is still requested separately here
// because the scope differs (webmasters.readonly vs. analytics.readonly);
// GoogleAuth is cached per-scope, not shared with ga4.ts's instance.
//
// SITE_URL must be the exact string Search Console uses to identify the
// property, not a URL you construct yourself:
//   - Domain property (verified via DNS/registrar, no https://):
//     "sc-domain:example.com"
//   - URL-prefix property (verified via GTM/HTML tag/etc.):
//     "https://www.example.com/" (note trailing slash)
// educoreafrica.com was verified as a Domain property (via the domain
// provider's registrar integration, not GTM as originally planned -- GTM
// verification isn't offered for Domain properties), so the value here is
// "sc-domain:educoreafrica.com". Get this wrong and every request 403s --
// there's no partial-match fallback.
//
// KNOWN GAPS / caveats (documented deliberately, same policy as ga4.ts):
//   - Search Console's date range is interpreted in Pacific Time (PT,
//     UTC-7/8), while GA4's is the property's configured timezone (see
//     ga4.ts). The two "Last 7 days" panels on the same page may therefore
//     cover slightly different actual hours -- not reconciled here.
//   - Search Console data has a processing delay of a few days and the API
//     defaults to dataState: "final" (no partial/fresh data). Don't expect
//     the most recent 1-3 days to show anything -- that's normal, not a bug.
//   - ctr is a 0-1 fraction, matching GA4's bounceRate convention; both are
//     normalized to a percentage where displayed.

import { GoogleAuth } from "google-auth-library";

const SITE_URL = process.env.SEARCH_CONSOLE_SITE_URL;
const SERVICE_ACCOUNT_JSON = process.env.GOOGLE_SERVICE_ACCOUNT_JSON;
const API_BASE_URL = "https://www.googleapis.com/webmasters/v3";

export function isSearchConsoleConfigured(): boolean {
  return Boolean(SITE_URL && SERVICE_ACCOUNT_JSON);
}

// [startDate, endDate] as "YYYY-MM-DD", same shape as ga4.ts's GaDateRangeInput.
export type ScDateRangeInput = [string, string];

let cachedAuth: GoogleAuth | null = null;

function getAuthClient(): GoogleAuth | null {
  if (!SERVICE_ACCOUNT_JSON) return null;
  if (cachedAuth) return cachedAuth;
  try {
    const credentials = JSON.parse(SERVICE_ACCOUNT_JSON);
    cachedAuth = new GoogleAuth({
      credentials,
      scopes: ["https://www.googleapis.com/auth/webmasters.readonly"],
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
    console.error("Search Console auth failed", err);
    return null;
  }
}

type ScRow = { keys?: string[]; clicks?: number; impressions?: number; ctr?: number; position?: number };
type ScQueryResponse = { rows?: ScRow[]; responseAggregationType?: string };

// Every caller goes through here. Returns null on any configuration gap,
// auth failure, network failure, or non-2xx response -- same contract as
// ga4.ts's runReport.
async function runQuery(body: Record<string, unknown>): Promise<ScQueryResponse | null> {
  if (!SITE_URL) return null;
  const token = await getAccessToken();
  if (!token) return null;

  try {
    const res = await fetch(`${API_BASE_URL}/sites/${encodeURIComponent(SITE_URL)}/searchAnalytics/query`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
      // Same staleness tolerance as ga4.ts -- Search Console data itself
      // already lags a few days, so there's no benefit to querying more
      // often than this.
      next: { revalidate: 300 },
    });
    if (!res.ok) {
      console.error(`Search Console query failed: ${res.status} ${await res.text()}`);
      return null;
    }
    return (await res.json()) as ScQueryResponse;
  } catch (err) {
    console.error("Search Console query threw", err);
    return null;
  }
}

export type SearchOverviewStats = {
  clicks: number;
  impressions: number;
  ctr: number;
  position: number;
};

// Whole-period aggregate: no dimensions, so the single row (if any data
// exists for the range) is the total. Unlike ga4.ts's getOverviewStats,
// there's no metricAggregations equivalent to request here -- omitting
// dimensions is what produces one combined row.
export async function getSearchOverviewStats(dateRange: ScDateRangeInput): Promise<SearchOverviewStats | null> {
  const [startDate, endDate] = dateRange;
  const result = await runQuery({ startDate, endDate });
  const row = result?.rows?.[0];
  if (!row) return null;
  return {
    clicks: row.clicks ?? 0,
    impressions: row.impressions ?? 0,
    // Normalize 0-1 fraction to a percentage, matching how ga4.ts's
    // bounceRate is normalized for display.
    ctr: (row.ctr ?? 0) * 100,
    position: row.position ?? 0,
  };
}

export type SearchTimeseriesPoint = { date: string; clicks: number; impressions: number };

export async function getSearchTimeseries(dateRange: ScDateRangeInput): Promise<SearchTimeseriesPoint[] | null> {
  const [startDate, endDate] = dateRange;
  const result = await runQuery({ startDate, endDate, dimensions: ["date"] });
  if (!result?.rows) return null;
  return result.rows.map((row) => ({
    date: row.keys?.[0] ?? "",
    clicks: row.clicks ?? 0,
    impressions: row.impressions ?? 0,
  }));
}

export type SearchBreakdownRow = { label: string; clicks: number; impressions: number };

async function getSearchBreakdown(
  dateRange: ScDateRangeInput,
  dimension: string,
  limit = 10,
): Promise<SearchBreakdownRow[] | null> {
  const [startDate, endDate] = dateRange;
  const result = await runQuery({
    startDate,
    endDate,
    dimensions: [dimension],
    rowLimit: limit,
    // Results are sorted by clicks descending by default (per the API
    // reference) -- no orderBy parameter exists on this endpoint, unlike
    // GA4's runReport, so there's nothing to set explicitly here.
  });
  if (!result?.rows) return null;
  return result.rows.map((row) => ({
    label: row.keys?.[0] || "(none)",
    clicks: row.clicks ?? 0,
    impressions: row.impressions ?? 0,
  }));
}

export function getTopQueries(dateRange: ScDateRangeInput, limit = 10) {
  return getSearchBreakdown(dateRange, "query", limit);
}

export function getTopSearchPages(dateRange: ScDateRangeInput, limit = 10) {
  return getSearchBreakdown(dateRange, "page", limit);
}

export function getSearchDeviceBreakdown(dateRange: ScDateRangeInput) {
  return getSearchBreakdown(dateRange, "device", 10);
}

export function getSearchCountryBreakdown(dateRange: ScDateRangeInput, limit = 10) {
  return getSearchBreakdown(dateRange, "country", limit);
}
