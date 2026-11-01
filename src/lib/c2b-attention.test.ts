import { beforeEach, describe, expect, it, vi } from "vitest";

const sendSecurityAlert = vi.fn();
vi.mock("@/lib/security-alert", () => ({ sendSecurityAlert: (...a: unknown[]) => sendSecurityAlert(...a) }));

import {
  alertIfStale,
  attentionLines,
  failedSinceIso,
  isFirstRunOfHour,
  staleCutoffIso,
  summariseStale,
} from "./c2b-attention";
import type { SupabaseClient } from "@supabase/supabase-js";

const NOW = new Date("2026-11-01T10:05:00.000Z");

function fakeAdmin(result: { data: unknown; error: unknown }) {
  const q: Record<string, unknown> = {};
  for (const m of ["select", "eq", "lt", "order"]) q[m] = () => q;
  q.limit = () => Promise.resolve(result);
  return { from: () => q } as unknown as SupabaseClient;
}

beforeEach(() => sendSecurityAlert.mockReset());

describe("cutoffs", () => {
  it("stale cutoff is 60 minutes back", () => {
    expect(staleCutoffIso(NOW)).toBe("2026-11-01T09:05:00.000Z");
  });
  it("failed window is 30 days back", () => {
    expect(failedSinceIso(NOW)).toBe("2026-10-02T10:05:00.000Z");
  });
});

describe("summariseStale", () => {
  it("is null when nothing is stale", () => {
    expect(summariseStale([], NOW)).toBeNull();
  });
  it("counts events, distinct schools and the oldest age", () => {
    const s = summariseStale(
      [
        { school_id: "a", created_at: "2026-11-01T08:05:00.000Z" },
        { school_id: "a", created_at: "2026-11-01T08:55:00.000Z" },
        { school_id: "b", created_at: "2026-11-01T09:00:00.000Z" },
      ],
      NOW,
    );
    expect(s).toEqual({ count: 3, capped: false, schools: 2, oldestMinutes: 120 });
  });
  it("ignores rows with an unusable time", () => {
    expect(summariseStale([{ school_id: "a", created_at: "garbage" }], NOW)).toBeNull();
  });
});

describe("isFirstRunOfHour", () => {
  it("is true in the first quarter of the UTC hour only", () => {
    expect(isFirstRunOfHour(new Date("2026-11-01T10:00:00Z"))).toBe(true);
    expect(isFirstRunOfHour(new Date("2026-11-01T10:14:59Z"))).toBe(true);
    expect(isFirstRunOfHour(new Date("2026-11-01T10:15:00Z"))).toBe(false);
    expect(isFirstRunOfHour(new Date("2026-11-01T10:45:00Z"))).toBe(false);
  });
});

describe("attentionLines", () => {
  it("is empty when nothing needs attention", () => {
    expect(attentionLines({ failedCount: 0, staleDeferred: 0 })).toEqual([]);
  });
  it("describes failed and waiting payments in plain language, singular and plural", () => {
    const one = attentionLines({ failedCount: 1, staleDeferred: 1 });
    expect(one).toHaveLength(2);
    expect(one[0]).toContain("1 paybill payment could not be processed");
    expect(one[1]).toContain("1 paybill payment has been waiting");
    const many = attentionLines({ failedCount: 3, staleDeferred: 0 });
    expect(many).toHaveLength(1);
    expect(many[0]).toContain("3 paybill payments could not be processed");
  });
});

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
