import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// ga4.ts reads its config from the environment when it is first imported, so each test sets the
// env, resets the module registry and imports a fresh copy. Auth and the network are faked.
vi.mock("google-auth-library", () => ({
  GoogleAuth: class {
    async getClient() {
      return { getAccessToken: async () => ({ token: "test-token" }) };
    }
  },
}));

async function loadGa4() {
  vi.resetModules();
  return import("./ga4");
}

function respondWith(body: unknown, init: { ok?: boolean; status?: number } = {}) {
  const fetchMock = vi.fn(async () => ({
    ok: init.ok ?? true,
    status: init.status ?? 200,
    json: async () => body,
    text: async () => JSON.stringify(body),
  }));
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

beforeEach(() => {
  vi.stubEnv("GA4_PROPERTY_ID", "123456");
  vi.stubEnv("GOOGLE_SERVICE_ACCOUNT_JSON", "{}");
  vi.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("getRealtimeVisitorCount", () => {
  it("returns the active-user count GA4 reports", async () => {
    respondWith({ rows: [{ metricValues: [{ value: "3" }] }] });
    const { getRealtimeVisitorCount } = await loadGa4();
    expect(await getRealtimeVisitorCount()).toBe(3);
  });

  it("returns 0, not null, when GA4 has no rows because nobody is active", async () => {
    respondWith({ rowCount: 0 });
    const { getRealtimeVisitorCount } = await loadGa4();
    expect(await getRealtimeVisitorCount()).toBe(0);
  });

  it("returns null and logs when GA4 answers with an error", async () => {
    respondWith({ error: "denied" }, { ok: false, status: 403 });
    const { getRealtimeVisitorCount } = await loadGa4();
    expect(await getRealtimeVisitorCount()).toBeNull();
    expect(console.error).toHaveBeenCalled();
  });

  it("returns null and logs when the request throws", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => { throw new Error("boom"); }));
    const { getRealtimeVisitorCount } = await loadGa4();
    expect(await getRealtimeVisitorCount()).toBeNull();
    expect(console.error).toHaveBeenCalled();
  });

  it("returns null when GA4 is not configured", async () => {
    vi.stubEnv("GA4_PROPERTY_ID", "");
    const fetchMock = respondWith({});
    const { getRealtimeVisitorCount } = await loadGa4();
    expect(await getRealtimeVisitorCount()).toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe("getOverviewStats", () => {
  const range: [string, string] = ["2026-10-17", "2026-10-17"];

  it("returns zeros when GA4 has no data for the period", async () => {
    respondWith({ rowCount: 0 });
    const { getOverviewStats } = await loadGa4();
    expect(await getOverviewStats(range)).toEqual({
      visitors: 0,
      visits: 0,
      pageviews: 0,
      viewsPerVisit: 0,
      bounceRate: 0,
      visitDurationSeconds: 0,
    });
  });

  it("returns null when the request fails", async () => {
    respondWith({ error: "denied" }, { ok: false, status: 403 });
    const { getOverviewStats } = await loadGa4();
    expect(await getOverviewStats(range)).toBeNull();
  });

  it("maps real values and converts bounce rate to a percentage", async () => {
    respondWith({
      totals: [{ metricValues: ["5", "7", "20", "2.5", "0.4", "63"].map((value) => ({ value })) }],
    });
    const { getOverviewStats } = await loadGa4();
    expect(await getOverviewStats(range)).toEqual({
      visitors: 5,
      visits: 7,
      pageviews: 20,
      viewsPerVisit: 2.5,
      bounceRate: 40,
      visitDurationSeconds: 63,
    });
  });
});
