import { describe, expect, it } from "vitest";
import { alertedIdsFromDetails, newlyStale, oldestAgeMinutes, staleWindow } from "./mpesa-stale-pending";

const NOW = new Date("2026-10-03T12:00:00.000Z");

describe("staleWindow", () => {
  it("is 10 minutes ago .. 24 hours ago", () => {
    const w = staleWindow(NOW);
    expect(w.olderThan).toBe("2026-10-03T11:50:00.000Z");
    expect(w.notOlderThan).toBe("2026-10-02T12:00:00.000Z");
  });
});

describe("alertedIdsFromDetails", () => {
  it("collects ids from comma-separated request_ids and ignores junk", () => {
    const ids = alertedIdsFromDetails([{ request_ids: "a, b,c" }, { request_ids: "c,d" }, null, { other: 1 }, { request_ids: 5 }]);
    expect([...ids].sort()).toEqual(["a", "b", "c", "d"]);
  });
});

describe("newlyStale", () => {
  it("drops rows that were already alerted and keeps new ones", () => {
    const rows = [
      { id: "a", initiated_at: "2026-10-03T11:00:00Z" },
      { id: "b", initiated_at: "2026-10-03T11:30:00Z" },
    ];
    expect(newlyStale(rows, new Set(["a"])).map((r) => r.id)).toEqual(["b"]);
    expect(newlyStale(rows, new Set(["a", "b"]))).toEqual([]);
    expect(newlyStale(rows, new Set()).length).toBe(2);
  });
});

describe("oldestAgeMinutes", () => {
  it("returns minutes since the oldest row, 0 when empty", () => {
    expect(oldestAgeMinutes([{ id: "a", initiated_at: "2026-10-03T11:00:00Z" }, { id: "b", initiated_at: "2026-10-03T11:45:00Z" }], NOW)).toBe(60);
    expect(oldestAgeMinutes([], NOW)).toBe(0);
  });
});
