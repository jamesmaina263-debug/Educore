// Client for the public Overpass API (OpenStreetMap queries). These free community servers are often
// overloaded or rate-limit shared cloud IP ranges, so a single attempt on one or two servers fails more
// often than you'd like. This tries several mirrors, retries once on a retryable failure, treats the
// "HTTP 200 with a runtime-error remark" case as a failure, stays under the caller's time budget, and
// reports EVERY server's outcome (host + status only) instead of just the last one.
//
// Network access is injected (fetchImpl/sleep/now) so the logic is unit-tested without the network.

export const OVERPASS_ENDPOINTS = [
  "https://overpass-api.de/api/interpreter",
  "https://overpass.private.coffee/api/interpreter",
  "https://overpass.kumi.systems/api/interpreter",
] as const;

const RETRYABLE_STATUSES = new Set([429, 500, 502, 503, 504]);
const USER_AGENT = "EduCore-Outreach/1.0 (school discovery; polite client, one county per request)";

export type OverpassOptions = {
  endpoints?: readonly string[];
  /** Total time we are willing to spend across all servers (the caller's function limit minus headroom). */
  budgetMs?: number;
  perRequestMs?: number;
  retryDelayMs?: number;
  fetchImpl?: typeof fetch;
  sleep?: (ms: number) => Promise<void>;
  now?: () => number;
};

export type OverpassResult = { ok: true; data: unknown; host: string } | { ok: false; summary: string; failures: string[] };

const hostOf = (url: string) => {
  try {
    return new URL(url).host;
  } catch {
    return url;
  }
};

/** Overpass answers 200 even when the query failed server-side; the reason is in "remark". */
function runtimeRemark(data: unknown): string | null {
  const remark = (data as { remark?: unknown } | null)?.remark;
  if (typeof remark !== "string") return null;
  return /runtime error|timed out|out of memory|too many requests|rate_limited/i.test(remark) ? "runtime error" : null;
}

/** `query` may be a function so different servers can get a variant they support (see buildOverpassQuery). */
export async function fetchOverpassJson(
  query: string | ((endpoint: string) => string),
  opts: OverpassOptions = {},
): Promise<OverpassResult> {
  const endpoints = opts.endpoints ?? OVERPASS_ENDPOINTS;
  const budgetMs = opts.budgetMs ?? 45_000;
  const perRequestMs = opts.perRequestMs ?? 20_000;
  const retryDelayMs = opts.retryDelayMs ?? 1_500;
  const doFetch = opts.fetchImpl ?? fetch;
  const sleep = opts.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
  const now = opts.now ?? Date.now;

  const started = now();
  const failures: string[] = [];

  for (const endpoint of endpoints) {
    const host = hostOf(endpoint);
    for (let attempt = 1; attempt <= 2; attempt++) {
      const left = budgetMs - (now() - started);
      if (left < 3_000) {
        failures.push(`${host} skipped (out of time)`);
        break;
      }
      let retryable = true;
      try {
        const res = await doFetch(endpoint, {
          method: "POST",
          // Browsers may not set User-Agent (and a custom header would force a CORS preflight the servers
          // don't answer), so it is only sent from the server.
          headers: {
            "Content-Type": "application/x-www-form-urlencoded",
            ...(typeof window === "undefined" ? { "User-Agent": USER_AGENT } : {}),
          },
          body: new URLSearchParams({ data: typeof query === "function" ? query(endpoint) : query }).toString(),
          signal: AbortSignal.timeout(Math.min(perRequestMs, left)),
          cache: "no-store",
        });
        if (res.ok) {
          const data = await res.json();
          if (runtimeRemark(data)) {
            failures.push(`${host} query failed on the server`);
          } else {
            return { ok: true, data, host };
          }
        } else {
          failures.push(`${host} ${res.status}`);
          retryable = RETRYABLE_STATUSES.has(res.status);
        }
      } catch (e) {
        const timedOut = e instanceof Error && (e.name === "TimeoutError" || e.name === "AbortError");
        failures.push(`${host} ${timedOut ? "timed out" : "unreachable"}`);
      }
      if (!retryable) break; // e.g. 400: the query itself is wrong, retrying the same server won't help
      if (attempt === 1) await sleep(retryDelayMs);
    }
  }
  return { ok: false, summary: failures.join(", ") || "no server answered", failures };
}
