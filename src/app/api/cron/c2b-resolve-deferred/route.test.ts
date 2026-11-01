import { beforeEach, describe, expect, it, vi } from "vitest";

const sendSecurityAlert = vi.fn();
vi.mock("@/lib/security-alert", () => ({ sendSecurityAlert: (...a: unknown[]) => sendSecurityAlert(...a) }));

const alertIfStale = vi.fn();
vi.mock("@/lib/c2b-attention", () => ({ alertIfStale: (...a: unknown[]) => alertIfStale(...a) }));

const rpc = vi.fn();
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => ({ rpc: (...a: unknown[]) => rpc(...a) }) }));

import { GET } from "./route";

function call(auth?: string) {
  return GET(
    new Request("https://www.educoreafrica.com/api/cron/c2b-resolve-deferred", {
      headers: auth ? { authorization: auth } : {},
    }),
  );
}

beforeEach(() => {
  process.env.CRON_SECRET = "cron-secret";
  process.env.EXTERNAL_CRON_SECRET = "external-secret";
  rpc.mockReset();
  sendSecurityAlert.mockReset();
  alertIfStale.mockReset();
  alertIfStale.mockResolvedValue({ staleCount: 0, alerted: false, checkFailed: false });
});

describe("GET /api/cron/c2b-resolve-deferred", () => {
  it("rejects a missing or wrong secret without touching the database", async () => {
    expect((await call()).status).toBe(401);
    expect((await call("Bearer nope")).status).toBe(401);
    expect(rpc).not.toHaveBeenCalled();
  });

  it("returns 500 when no secret is configured", async () => {
    delete process.env.CRON_SECRET;
    delete process.env.EXTERNAL_CRON_SECRET;
    expect((await call("Bearer anything")).status).toBe(500);
    expect(rpc).not.toHaveBeenCalled();
  });

  it("accepts either secret and reports how many events were resolved", async () => {
    rpc.mockResolvedValue({ data: 3, error: null });
    for (const secret of ["cron-secret", "external-secret"]) {
      const res = await call(`Bearer ${secret}`);
      expect(res.status).toBe(200);
      expect(await res.json()).toMatchObject({ resolved: 3 });
    }
    expect(rpc).toHaveBeenCalledWith("c2b_resolve_deferred_events");
  });

  it("is a no-op that reports 0 when nothing is deferred", async () => {
    rpc.mockResolvedValue({ data: 0, error: null });
    const res = await call("Bearer cron-secret");
    expect(await res.json()).toMatchObject({ resolved: 0 });
    expect(sendSecurityAlert).not.toHaveBeenCalled();
  });

  it("alerts and returns 500 when the database call fails", async () => {
    rpc.mockResolvedValue({ data: null, error: { message: "boom" } });
    const res = await call("Bearer cron-secret");
    expect(res.status).toBe(500);
    expect(sendSecurityAlert).toHaveBeenCalledTimes(1);
  });

  it("also checks for events parked over an hour, throttled hourly, and reports the count", async () => {
    rpc.mockResolvedValue({ data: 0, error: null });
    alertIfStale.mockResolvedValue({ staleCount: 4, alerted: false, checkFailed: false });
    const res = await call("Bearer cron-secret");
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ resolved: 0, stale_deferred: 4, stale_check: "ok" });
    expect(alertIfStale).toHaveBeenCalledWith(expect.anything(), { throttleHourly: true });
  });

  it("still succeeds when the stale check itself fails", async () => {
    rpc.mockResolvedValue({ data: 2, error: null });
    alertIfStale.mockResolvedValue({ staleCount: 0, alerted: false, checkFailed: true });
    const res = await call("Bearer cron-secret");
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ resolved: 2, stale_check: "failed" });
  });

  it("does not run the stale check when the resolver itself failed", async () => {
    rpc.mockResolvedValue({ data: null, error: { message: "boom" } });
    await call("Bearer cron-secret");
    expect(alertIfStale).not.toHaveBeenCalled();
  });
});
