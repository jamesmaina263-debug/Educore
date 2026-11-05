import { beforeEach, describe, expect, it, vi } from "vitest";

const rpc = vi.fn();
const sendSecurityAlert = vi.fn();
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => ({ rpc: (...a: unknown[]) => rpc(...a) }) }));
vi.mock("@/lib/security-alert", () => ({ sendSecurityAlert: (...a: unknown[]) => sendSecurityAlert(...a) }));

import { GET } from "./route";

function call(auth?: string) {
  return GET(new Request("https://www.educoreafrica.com/api/cron/director-alerts", { headers: auth ? { authorization: auth } : {} }));
}

beforeEach(() => {
  process.env.CRON_SECRET = "cron-secret";
  delete process.env.EXTERNAL_CRON_SECRET;
  rpc.mockReset();
  sendSecurityAlert.mockReset();
});

describe("GET /api/cron/director-alerts (dry-run)", () => {
  it("rejects a missing or wrong secret without evaluating anything", async () => {
    expect((await call()).status).toBe(401);
    expect((await call("Bearer nope")).status).toBe(401);
    expect(rpc).not.toHaveBeenCalled();
  });

  it("returns 500 when no cron secret is configured", async () => {
    delete process.env.CRON_SECRET;
    expect((await call("Bearer anything")).status).toBe(500);
    expect(rpc).not.toHaveBeenCalled();
  });

  it("accepts the external cron secret too", async () => {
    delete process.env.CRON_SECRET;
    process.env.EXTERNAL_CRON_SECRET = "ext-secret";
    rpc.mockResolvedValue({ data: [], error: null });
    expect((await call("Bearer ext-secret")).status).toBe(200);
  });

  it("evaluates and returns counts only, in dry-run mode", async () => {
    rpc.mockResolvedValue({
      data: [
        { log_id: "1", school_id: "s1", school_user_id: "u1", phone: "+254700000111", alert_type: "large_payment", payload: { amount: 60000 } },
        { log_id: "2", school_id: "s1", school_user_id: "u1", phone: "+254700000111", alert_type: "low_attendance", payload: { rate_pct: 67 } },
      ],
      error: null,
    });
    const res = await call("Bearer cron-secret");
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(rpc).toHaveBeenCalledWith("director_alerts_evaluate");
    expect(body).toMatchObject({ mode: "dry_run", total: 2, schools: 1, directors: 1, by_type: { large_payment: 1, low_attendance: 1, collection_drop: 0 } });
    expect(JSON.stringify(body)).not.toMatch(/254700000111|60000|rate_pct/);
  });

  it("reports 0 when nothing is due (flags off)", async () => {
    rpc.mockResolvedValue({ data: [], error: null });
    expect(await (await call("Bearer cron-secret")).json()).toMatchObject({ total: 0 });
  });

  it("alerts and returns 500 when the database call fails", async () => {
    rpc.mockResolvedValue({ data: null, error: { message: "boom" } });
    const res = await call("Bearer cron-secret");
    expect(res.status).toBe(500);
    expect(sendSecurityAlert).toHaveBeenCalled();
  });
});
