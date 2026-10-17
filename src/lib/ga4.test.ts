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

describe("getRealtimeSnapshot", () => {
  function respondByDimension() {
    const fetchMock = vi.fn(async (_url: string, init?: { body?: string }) => {
      const body = JSON.parse(init?.body ?? "{}");
      const dim = body.dimensions?.[0]?.name;
      const payloads: Record<string, unknown> = {
        minutesAgo: {
          rows: [
            { dimensionValues: [{ value: "00" }], metricValues: [{ value: "2" }] },
            { dimensionValues: [{ value: "07" }], metricValues: [{ value: "1" }] },
            { dimensionValues: [{ value: "99" }], metricValues: [{ value: "5" }] },
          ],
        },
        unifiedScreenName: {
          rows: [{ dimensionValues: [{ value: "EduCore | Home" }], metricValues: [{ value: "3" }, { value: "6" }] }],
          totals: [{ metricValues: [{ value: "3" }, { value: "6" }] }],
        },
        country: {
          rows: [
            { dimensionValues: [{ value: "Kenya" }, { value: "Nairobi" }], metricValues: [{ value: "2" }] },
            { dimensionValues: [{ value: "Kenya" }, { value: "(not set)" }], metricValues: [{ value: "1" }] },
          ],
        },
        deviceCategory: {
          rows: [{ dimensionValues: [{ value: "mobile" }], metricValues: [{ value: "3" }] }],
          totals: [{ metricValues: [{ value: "3" }] }],
        },
        eventName: {
          rows: [{ dimensionValues: [{ value: "page_view" }], metricValues: [{ value: "6" }] }],
        },
      };
      const payload = payloads[dim] ?? {};
      return { ok: true, status: 200, json: async () => payload, text: async () => JSON.stringify(payload) };
    });
    vi.stubGlobal("fetch", fetchMock);
    return fetchMock;
  }

  it("assembles totals, per-minute activity and breakdowns from the Realtime API", async () => {
    const fetchMock = respondByDimension();
    const { getRealtimeSnapshot } = await loadGa4();
    const snap = await getRealtimeSnapshot();
    expect(snap).not.toBeNull();
    expect(snap!.activeUsers).toBe(3);
    expect(snap!.pageViews).toBe(6);
    expect(snap!.perMinute).toHaveLength(30);
    expect(snap!.perMinute[0]).toBe(2);
    expect(snap!.perMinute[7]).toBe(1);
    // an out-of-range minute from GA4 is ignored rather than written past the window
    expect(snap!.perMinute.reduce((a, b) => a + b, 0)).toBe(3);
    expect(snap!.topPages).toEqual([{ label: "EduCore | Home", value: 6 }]);
    expect(snap!.locations).toEqual([
      { label: "Nairobi, Kenya", value: 2 },
      { label: "Kenya", value: 1 },
    ]);
    expect(snap!.devices).toEqual([{ label: "mobile", value: 3 }]);
    expect(snap!.events).toEqual([{ label: "page_view", value: 6 }]);
    // every call goes to the Realtime endpoint, never the cached standard report
    for (const [url] of fetchMock.mock.calls) expect(String(url)).toContain(":runRealtimeReport");
  });

  it("returns real zeros, not null, when nobody is active", async () => {
    respondWith({ rowCount: 0 });
    const { getRealtimeSnapshot } = await loadGa4();
    const snap = await getRealtimeSnapshot();
    expect(snap).not.toBeNull();
    expect(snap!.activeUsers).toBe(0);
    expect(snap!.pageViews).toBe(0);
    expect(snap!.perMinute.every((n) => n === 0)).toBe(true);
    expect(snap!.topPages).toEqual([]);
  });

  it("returns null when GA4 answers with an error", async () => {
    respondWith({ error: "denied" }, { ok: false, status: 403 });
    const { getRealtimeSnapshot } = await loadGa4();
    expect(await getRealtimeSnapshot()).toBeNull();
  });

  it("returns null without calling GA4 when it is not configured", async () => {
    vi.stubEnv("GA4_PROPERTY_ID", "");
    const fetchMock = respondWith({});
    const { getRealtimeSnapshot } = await loadGa4();
    expect(await getRealtimeSnapshot()).toBeNull();
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
