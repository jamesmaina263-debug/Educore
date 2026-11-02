import { beforeEach, describe, expect, it, vi } from "vitest";

const sendSecurityAlert = vi.fn();
vi.mock("@/lib/security-alert", () => ({ sendSecurityAlert: (...a: unknown[]) => sendSecurityAlert(...a) }));

import { alertIfStale } from "./c2b-stale-alert";
import type { SupabaseClient } from "@supabase/supabase-js";

const NOW = new Date("2026-11-01T10:05:00.000Z");

function fakeAdmin(result: { data: unknown; error: unknown }) {
  const q: Record<string, unknown> = {};
  for (const m of ["select", "eq", "lt", "order"]) q[m] = () => q;
  q.limit = () => Promise.resolve(result);
  return { from: () => q } as unknown as SupabaseClient;
}

beforeEach(() => sendSecurityAlert.mockReset());

describe("alertIfStale", () => {
  const stale = [{ school_id: "s1", created_at: "2026-11-01T08:05:00.000Z" }];

  it("does nothing and does not alert when nothing is stale", async () => {
    const r = await alertIfStale(fakeAdmin({ data: [], error: null }), { throttleHourly: false, now: NOW });
    expect(r).toEqual({ staleCount: 0, alerted: false, checkFailed: false });
    expect(sendSecurityAlert).not.toHaveBeenCalled();
  });

  it("alerts once with counts and ages only (no school names or payment data)", async () => {
    const r = await alertIfStale(fakeAdmin({ data: stale, error: null }), { throttleHourly: false, now: NOW });
    expect(r).toEqual({ staleCount: 1, alerted: true, checkFailed: false });
    expect(sendSecurityAlert).toHaveBeenCalledTimes(1);
    const [event, detail] = sendSecurityAlert.mock.calls[0] as [string, Record<string, string>];
    expect(event).toContain("stuck waiting for STK");
    expect(Object.keys(detail).sort()).toEqual(["action", "events", "oldest_minutes", "schools"]);
    expect(detail.events).toBe("1");
    expect(detail.oldest_minutes).toBe("120");
  });

  it("throttles to the first run of each hour when asked", async () => {
    const late = new Date("2026-11-01T10:35:00.000Z");
    const r = await alertIfStale(fakeAdmin({ data: stale, error: null }), { throttleHourly: true, now: late });
    expect(r).toMatchObject({ staleCount: 1, alerted: false });
    expect(sendSecurityAlert).not.toHaveBeenCalled();
    const early = await alertIfStale(fakeAdmin({ data: stale, error: null }), { throttleHourly: true, now: NOW });
    expect(early.alerted).toBe(true);
  });

  it("reports a failed check instead of throwing or alerting", async () => {
    const r = await alertIfStale(fakeAdmin({ data: null, error: { message: "boom" } }), { throttleHourly: false, now: NOW });
    expect(r).toEqual({ staleCount: 0, alerted: false, checkFailed: true });
    expect(sendSecurityAlert).not.toHaveBeenCalled();
  });
});
