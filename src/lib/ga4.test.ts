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

describe("getRealtimeSnapshot caching and rate limiting", () => {
  const ok = { rows: [{ dimensionValues: [{ value: "desktop" }], metricValues: [{ value: "2" }] }], totals: [{ metricValues: [{ value: "2" }, { value: "5" }] }] };

  it("makes its five calls one at a time", async () => {
    let inFlight = 0;
    let maxInFlight = 0;
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        inFlight++;
        maxInFlight = Math.max(maxInFlight, inFlight);
        await new Promise((r) => setTimeout(r, 1));
        inFlight--;
        return { ok: true, status: 200, json: async () => ok, text: async () => "" };
      }),
    );
    const { getRealtimeSnapshot } = await loadGa4();
    expect(await getRealtimeSnapshot()).not.toBeNull();
    expect(maxInFlight).toBe(1);
  });

  it("serves a recent snapshot from cache and shares one build between concurrent callers", async () => {
    const fetchMock = respondWith(ok);
    const { getRealtimeSnapshot } = await loadGa4();
    const [a, b] = await Promise.all([getRealtimeSnapshot(), getRealtimeSnapshot()]);
    expect(a).toEqual(b);
    expect(fetchMock).toHaveBeenCalledTimes(5);
    await getRealtimeSnapshot();
    expect(fetchMock).toHaveBeenCalledTimes(5);
  });

  it("stops at the first 429, makes no calls during the cool-down, then recovers", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    try {
      vi.setSystemTime(new Date("2026-10-17T10:00:00Z"));
      const fetchMock = respondWith({ error: "quota" }, { ok: false, status: 429 });
      const { getRealtimeSnapshot } = await loadGa4();
      expect(await getRealtimeSnapshot()).toBeNull();
      expect(fetchMock).toHaveBeenCalledTimes(1); // bailed out instead of firing all five
      expect(await getRealtimeSnapshot()).toBeNull();
      expect(fetchMock).toHaveBeenCalledTimes(1); // cool-down: no new Google calls
      vi.setSystemTime(new Date("2026-10-17T10:01:05Z"));
      respondWith(ok);
      expect(await getRealtimeSnapshot()).not.toBeNull();
    } finally {
      vi.useRealTimers();
    }
  });

  it("keeps serving the last good reading, marked stale, when Google then rate-limits", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    try {
      vi.setSystemTime(new Date("2026-10-17T10:00:00Z"));
      respondWith(ok);
      const { getRealtimeSnapshot } = await loadGa4();
      const first = await getRealtimeSnapshot();
      expect(first?.stale).toBeUndefined();
      vi.setSystemTime(new Date("2026-10-17T10:00:30Z")); // past the 20s cache
      respondWith({ error: "quota" }, { ok: false, status: 429 });
      const second = await getRealtimeSnapshot();
      expect(second?.stale).toBe(true);
      expect(second?.activeUsers).toBe(first?.activeUsers);
      vi.setSystemTime(new Date("2026-10-17T10:06:00Z")); // older than the 5-minute stale limit
      respondWith({ error: "quota" }, { ok: false, status: 429 });
      expect(await getRealtimeSnapshot()).toBeNull();
    } finally {
      vi.useRealTimers();
    }
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

describe("runReport concurrency and 429 backoff", () => {
  const range: [string, string] = ["2026-10-17", "2026-10-17"];
  const rateLimited = { ok: false, status: 429, json: async () => ({}), text: async () => "quota exhausted" };
  const okResponse = { ok: true, status: 200, json: async () => ({ rowCount: 0 }), text: async () => "" };

  afterEach(() => {
    vi.useRealTimers();
  });

  it("never has more than four requests in flight, and still completes every report", async () => {
    let inFlight = 0;
    let peak = 0;
    const fetchMock = vi.fn(async (_url: string, init?: { body?: string }) => {
      inFlight++;
      peak = Math.max(peak, inFlight);
      await new Promise((resolve) => setTimeout(resolve, 5));
      inFlight--;
      const requests = JSON.parse(init?.body ?? "{}").requests ?? [];
      return { ...okResponse, json: async () => ({ reports: requests.map(() => ({ rowCount: 0 })) }) };
    });
    vi.stubGlobal("fetch", fetchMock);
    const { getOverviewStats } = await loadGa4();

    const results = await Promise.all(Array.from({ length: 12 }, () => getOverviewStats(range)));

    expect(results.every((r) => r !== null)).toBe(true);
    // 12 reports are sent as batches of 5, 5 and 2 -- three requests, not twelve.
    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(peak).toBeLessThanOrEqual(4);
  });

  it("retries a 429 after a short backoff and returns the data once Google accepts", async () => {
    vi.useFakeTimers();
    const fetchMock = vi.fn().mockResolvedValueOnce(rateLimited).mockResolvedValue(okResponse);
    vi.stubGlobal("fetch", fetchMock);
    const { getOverviewStats } = await loadGa4();

    const pending = getOverviewStats(range);
    await vi.advanceTimersByTimeAsync(2000);

    expect(await pending).not.toBeNull();
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("gives up after three attempts on a persistent 429, returning null and logging it", async () => {
    vi.useFakeTimers();
    const fetchMock = vi.fn().mockResolvedValue(rateLimited);
    vi.stubGlobal("fetch", fetchMock);
    const { getOverviewStats } = await loadGa4();

    const pending = getOverviewStats(range);
    await vi.advanceTimersByTimeAsync(5000);

    expect(await pending).toBeNull();
    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(console.error).toHaveBeenCalledWith(expect.stringContaining("429"));
  });

  it("does not retry errors other than 429", async () => {
    const fetchMock = respondWith({ error: "denied" }, { ok: false, status: 403 });
    const { getOverviewStats } = await loadGa4();
    expect(await getOverviewStats(range)).toBeNull();
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});

describe("runReport batching (batchRunReports)", () => {
  type FakeResponse = { ok: boolean; status: number; json: () => Promise<unknown>; text: () => Promise<string> };
  // Each report's totals carry the start date it was asked for, so a test can tell that every
  // caller received its own report back rather than a neighbour's.
  function batchResponder(onBatch?: (requests: Array<{ dateRanges: Array<{ startDate: string }> }>) => void) {
    return vi.fn(async (url: string, init?: { body?: string }) => {
      const parsed = JSON.parse(init?.body ?? "{}");
      const reportFor = (r: { dateRanges: Array<{ startDate: string }> }) => ({
        totals: [{ metricValues: [r.dateRanges[0].startDate.slice(-2), "0", "0", "0", "0", "0"].map((value) => ({ value })) }],
      });
      let payload: unknown;
      if (String(url).includes(":batchRunReports")) {
        onBatch?.(parsed.requests);
        payload = { reports: parsed.requests.map(reportFor) };
      } else {
        payload = reportFor(parsed);
      }
      return { ok: true, status: 200, json: async () => payload, text: async () => "" };
    });
  }

  const day = (n: number): [string, string] => [`2026-10-${String(n).padStart(2, "0")}`, `2026-10-${String(n).padStart(2, "0")}`];

  afterEach(() => {
    vi.useRealTimers();
  });

  it("sends 20 concurrent reports as four batchRunReports requests and routes each result back to its caller", async () => {
    const sizes: number[] = [];
    const fetchMock = batchResponder((requests) => sizes.push(requests.length));
    vi.stubGlobal("fetch", fetchMock);
    const { getOverviewStats } = await loadGa4();

    const results = await Promise.all(Array.from({ length: 20 }, (_, i) => getOverviewStats(day(i + 1))));

    expect(fetchMock).toHaveBeenCalledTimes(4);
    expect(sizes).toEqual([5, 5, 5, 5]);
    for (const [url] of fetchMock.mock.calls) expect(String(url)).toContain(":batchRunReports");
    results.forEach((r, i) => expect(r?.visitors).toBe(i + 1));
  });

  it("uses the plain runReport endpoint for a lone report", async () => {
    const fetchMock = batchResponder();
    vi.stubGlobal("fetch", fetchMock);
    const { getOverviewStats } = await loadGa4();

    expect((await getOverviewStats(day(7)))?.visitors).toBe(7);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(String(fetchMock.mock.calls[0][0])).toContain(":runReport");
  });

  it("forms the same batch bodies whatever order the reports are requested in (keeps the fetch cache warm)", async () => {
    const bodies: string[] = [];
    const record = () =>
      vi.fn(async (_url: string, init?: { body?: string }) => {
        bodies.push(init?.body ?? "");
        const n = JSON.parse(init?.body ?? "{}").requests.length;
        return { ok: true, status: 200, json: async () => ({ reports: Array.from({ length: n }, () => ({})) }), text: async () => "" };
      });

    vi.stubGlobal("fetch", record());
    let ga4 = await loadGa4();
    await Promise.all([day(1), day(2), day(3)].map((d) => ga4.getOverviewStats(d)));
    vi.stubGlobal("fetch", record());
    ga4 = await loadGa4();
    await Promise.all([day(3), day(1), day(2)].map((d) => ga4.getOverviewStats(d)));

    expect(bodies).toHaveLength(2);
    expect(bodies[0]).toBe(bodies[1]);
  });

  it("falls back to individual reports when GA4 rejects a batch, so one bad report cannot blank the others", async () => {
    const fetchMock = vi.fn(async (url: string, init?: { body?: string }): Promise<FakeResponse> => {
      if (String(url).includes(":batchRunReports")) {
        return { ok: false, status: 400, json: async () => ({}), text: async () => "Field foo is not a valid dimension" };
      }
      const body = JSON.parse(init?.body ?? "{}");
      const start: string = body.dateRanges[0].startDate;
      if (start.endsWith("02")) return { ok: false, status: 400, json: async () => ({}), text: async () => "bad report" };
      return { ok: true, status: 200, json: async () => ({ totals: [{ metricValues: [start.slice(-2), "0", "0", "0", "0", "0"].map((value) => ({ value })) }] }), text: async () => "" };
    });
    vi.stubGlobal("fetch", fetchMock);
    const { getOverviewStats } = await loadGa4();

    const [a, b, c] = await Promise.all([getOverviewStats(day(1)), getOverviewStats(day(2)), getOverviewStats(day(3))]);

    expect(a?.visitors).toBe(1);
    expect(b).toBeNull(); // the genuinely bad report fails alone
    expect(c?.visitors).toBe(3);
    expect(fetchMock).toHaveBeenCalledTimes(1 + 3); // one batch attempt, then one call per report
  });

  it("falls back to individual reports when the batch response has the wrong shape", async () => {
    const fetchMock = vi.fn(async (url: string, init?: { body?: string }): Promise<FakeResponse> => {
      if (String(url).includes(":batchRunReports")) {
        return { ok: true, status: 200, json: async () => ({ reports: [{}] }), text: async () => "" };
      }
      const start: string = JSON.parse(init?.body ?? "{}").dateRanges[0].startDate;
      return { ok: true, status: 200, json: async () => ({ totals: [{ metricValues: [start.slice(-2), "0", "0", "0", "0", "0"].map((value) => ({ value })) }] }), text: async () => "" };
    });
    vi.stubGlobal("fetch", fetchMock);
    const { getOverviewStats } = await loadGa4();

    const [a, b] = await Promise.all([getOverviewStats(day(4)), getOverviewStats(day(5))]);

    expect([a?.visitors, b?.visitors]).toEqual([4, 5]);
    expect(console.error).toHaveBeenCalledWith(expect.stringContaining("unexpected shape"));
  });

  it("does not fan a persistent 429 out into individual retries: the batch backs off, then every report is null", async () => {
    vi.useFakeTimers();
    const fetchMock = vi.fn(async (_url: string): Promise<FakeResponse> => ({ ok: false, status: 429, json: async () => ({}), text: async () => "quota exhausted" }));
    vi.stubGlobal("fetch", fetchMock);
    const { getOverviewStats } = await loadGa4();

    const pending = Promise.all([getOverviewStats(day(1)), getOverviewStats(day(2)), getOverviewStats(day(3))]);
    await vi.advanceTimersByTimeAsync(5000);

    expect(await pending).toEqual([null, null, null]);
    expect(fetchMock).toHaveBeenCalledTimes(3); // the one batch, three attempts -- no per-report calls
    for (const [url] of fetchMock.mock.calls) expect(String(url)).toContain(":batchRunReports");
    expect(console.error).toHaveBeenCalledWith(expect.stringContaining("429"));
  });

  it("returns null for every report without calling GA4 when it is not configured", async () => {
    vi.stubEnv("GA4_PROPERTY_ID", "");
    const fetchMock = respondWith({});
    const { getOverviewStats } = await loadGa4();
    expect(await Promise.all([getOverviewStats(day(1)), getOverviewStats(day(2))])).toEqual([null, null]);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
