import { describe, expect, it, vi } from "vitest";
import { fetchOverpassJson } from "./overpass-client";

const EP = ["https://a.example/api", "https://b.example/api"] as const;
const ok = (body: unknown) => new Response(JSON.stringify(body), { status: 200 });
const base = { endpoints: EP, sleep: async () => {}, retryDelayMs: 0 };

describe("fetchOverpassJson", () => {
  it("lets each server receive its own query variant", async () => {
    const bodies: string[] = [];
    const fetchImpl = vi.fn(async (url: string, init?: RequestInit) => {
      bodies.push(`${String(url)} <- ${decodeURIComponent(String(init?.body).slice(5))}`);
      return String(url).includes("a.example") ? new Response("x", { status: 500 }) : ok({ elements: [] });
    });
    const r = await fetchOverpassJson((ep) => (ep.includes("a.example") ? "QUERY-A" : "QUERY-B"), {
      ...base,
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });
    expect(r).toMatchObject({ ok: true, host: "b.example" });
    expect(bodies[0]).toBe("https://a.example/api <- QUERY-A");
    expect(bodies[bodies.length - 1]).toBe("https://b.example/api <- QUERY-B");
  });

  it("returns data from the first server when it answers", async () => {
    const fetchImpl = vi.fn(async () => ok({ elements: [1] }));
    const r = await fetchOverpassJson("q", { ...base, fetchImpl: fetchImpl as unknown as typeof fetch });
    expect(r).toMatchObject({ ok: true, host: "a.example" });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it("retries a retryable failure once, then succeeds", async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(new Response("busy", { status: 429 }))
      .mockResolvedValueOnce(ok({ elements: [] }));
    const r = await fetchOverpassJson("q", { ...base, fetchImpl: fetchImpl as unknown as typeof fetch });
    expect(r).toMatchObject({ ok: true, host: "a.example" });
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it("falls through to the next server and lists every failure when all fail", async () => {
    const fetchImpl = vi.fn(async (url: string) =>
      String(url).includes("a.example") ? new Response("x", { status: 429 }) : new Response("x", { status: 500 }),
    );
    const r = await fetchOverpassJson("q", { ...base, fetchImpl: fetchImpl as unknown as typeof fetch });
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.summary).toBe("a.example 429, a.example 429, b.example 500, b.example 500");
    expect(fetchImpl).toHaveBeenCalledTimes(4);
  });

  it("does not retry a non-retryable status (bad query) on the same server", async () => {
    const fetchImpl = vi.fn(async (url: string) =>
      String(url).includes("a.example") ? new Response("bad", { status: 400 }) : ok({ elements: [] }),
    );
    const r = await fetchOverpassJson("q", { ...base, fetchImpl: fetchImpl as unknown as typeof fetch });
    expect(r).toMatchObject({ ok: true, host: "b.example" });
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it("treats a 200 response carrying a runtime-error remark as a failure and moves on", async () => {
    const fetchImpl = vi.fn(async (url: string) =>
      String(url).includes("a.example")
        ? ok({ elements: [], remark: 'runtime error: Query timed out in "query" at line 4 after 26 seconds.' })
        : ok({ elements: [{ id: 1 }] }),
    );
    const r = await fetchOverpassJson("q", { ...base, fetchImpl: fetchImpl as unknown as typeof fetch });
    expect(r).toMatchObject({ ok: true, host: "b.example" });
  });

  it("reports timeouts and unreachable servers by name, and never leaks the query", async () => {
    const timeout = Object.assign(new Error("t"), { name: "TimeoutError" });
    const fetchImpl = vi.fn(async (url: string) => {
      throw String(url).includes("a.example") ? timeout : new Error("ECONNRESET");
    });
    const r = await fetchOverpassJson("SECRET-QUERY", { ...base, fetchImpl: fetchImpl as unknown as typeof fetch });
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.summary).toContain("a.example timed out");
    expect(r.summary).toContain("b.example unreachable");
    expect(r.summary).not.toContain("SECRET-QUERY");
  });

  it("stops when the time budget is used up instead of running past the caller's limit", async () => {
    let t = 0;
    const fetchImpl = vi.fn(async () => {
      t += 30_000;
      return new Response("x", { status: 503 });
    });
    const r = await fetchOverpassJson("q", {
      ...base,
      budgetMs: 45_000,
      now: () => t,
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.summary).toContain("skipped (out of time)");
    expect(fetchImpl.mock.calls.length).toBeLessThanOrEqual(2);
  });
});
