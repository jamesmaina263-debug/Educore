import { beforeEach, describe, expect, it, vi } from "vitest";

const alertIfStale = vi.fn();
vi.mock("@/lib/c2b-attention", () => ({ alertIfStale: (...a: unknown[]) => alertIfStale(...a) }));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => ({}) }));

import { GET } from "./route";

function call(auth?: string) {
  return GET(
    new Request("https://www.educoreafrica.com/api/cron/c2b-stale-check", {
      headers: auth ? { authorization: auth } : {},
    }),
  );
}

beforeEach(() => {
  process.env.CRON_SECRET = "cron-secret";
  alertIfStale.mockReset();
});

describe("GET /api/cron/c2b-stale-check", () => {
  it("rejects a missing or wrong secret without checking anything", async () => {
    expect((await call()).status).toBe(401);
    expect((await call("Bearer nope")).status).toBe(401);
    expect(alertIfStale).not.toHaveBeenCalled();
  });

  it("returns 500 when CRON_SECRET is not configured", async () => {
    delete process.env.CRON_SECRET;
    expect((await call("Bearer anything")).status).toBe(500);
    expect(alertIfStale).not.toHaveBeenCalled();
  });

  it("runs the un-throttled check and reports the result", async () => {
    alertIfStale.mockResolvedValue({ staleCount: 2, alerted: true, checkFailed: false });
    const res = await call("Bearer cron-secret");
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ stale_deferred: 2, alerted: true });
    expect(alertIfStale).toHaveBeenCalledWith(expect.anything(), { throttleHourly: false });
  });

  it("returns 500 when the check could not read events, so Vercel shows the failure", async () => {
    alertIfStale.mockResolvedValue({ staleCount: 0, alerted: false, checkFailed: true });
    expect((await call("Bearer cron-secret")).status).toBe(500);
  });
});
