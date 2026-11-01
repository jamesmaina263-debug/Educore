import { beforeEach, describe, expect, it, vi } from "vitest";

const sendSecurityAlert = vi.fn();
vi.mock("@/lib/security-alert", () => ({ sendSecurityAlert: (...a: unknown[]) => sendSecurityAlert(...a) }));

const rpc = vi.fn();
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => ({ rpc: (...a: unknown[]) => rpc(...a) }) }));
vi.mock("@/lib/supabase/retry-transient-auth", () => ({
  withTransientAuthRetry: (fn: () => Promise<unknown>) => fn(),
}));

import { GET } from "./route";

function call(auth?: string) {
  return GET(
    new Request("https://www.educoreafrica.com/api/cron/fee-reminders", {
      headers: auth ? { authorization: auth } : {},
    }),
  );
}

beforeEach(() => {
  process.env.CRON_SECRET = "cron-secret";
  rpc.mockReset();
  sendSecurityAlert.mockReset();
});

describe("GET /api/cron/fee-reminders", () => {
  it("rejects a missing or wrong secret without touching the database", async () => {
    expect((await call()).status).toBe(401);
    expect((await call("Bearer nope")).status).toBe(401);
    expect(rpc).not.toHaveBeenCalled();
  });

  it("returns 500 when CRON_SECRET is not configured", async () => {
    delete process.env.CRON_SECRET;
    expect((await call("Bearer anything")).status).toBe(500);
    expect(rpc).not.toHaveBeenCalled();
  });

  it("calls generate_fee_reminders with no arguments and reports the drafted count", async () => {
    rpc.mockResolvedValue({ data: 4, error: null });
    const res = await call("Bearer cron-secret");
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ fee_reminders_drafted: 4 });
    expect(rpc).toHaveBeenCalledWith("generate_fee_reminders");
  });

  it("reports 0 when no school is due", async () => {
    rpc.mockResolvedValue({ data: 0, error: null });
    const res = await call("Bearer cron-secret");
    expect(await res.json()).toMatchObject({ fee_reminders_drafted: 0 });
  });

  it("alerts and returns 500 when the database call fails", async () => {
    rpc.mockResolvedValue({ data: null, error: { message: "boom" } });
    const res = await call("Bearer cron-secret");
    expect(res.status).toBe(500);
    expect(sendSecurityAlert).toHaveBeenCalledTimes(1);
  });
});
