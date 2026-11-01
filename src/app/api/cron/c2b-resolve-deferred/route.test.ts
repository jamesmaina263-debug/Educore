import { beforeEach, describe, expect, it, vi } from "vitest";

const sendSecurityAlert = vi.fn();
vi.mock("@/lib/security-alert", () => ({ sendSecurityAlert: (...a: unknown[]) => sendSecurityAlert(...a) }));

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
});
