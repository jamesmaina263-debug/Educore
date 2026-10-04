import { describe, expect, it } from "vitest";
import {
  RECONCILE_BATCH_SIZE,
  alertedIdsFromDetails,
  newlyStale,
  oldestAgeMinutes,
  pickReconcileBatch,
  staleWindow,
} from "./mpesa-stale-pending";

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

describe("pickReconcileBatch", () => {
  const row = (id: string, initiated_at: string, last_query_at: string | null) => ({ id, initiated_at, last_query_at });

  it("puts never-queried rows first, then least-recently-queried, oldest first within a tie", () => {
    const rows = [
      row("queried-recent", "2026-10-03T08:00:00.000Z", "2026-10-03T11:55:00.000Z"),
      row("fresh-newer", "2026-10-03T11:00:00.000Z", null),
      row("queried-old", "2026-10-03T07:00:00.000Z", "2026-10-03T09:00:00.000Z"),
      row("fresh-older", "2026-10-03T10:00:00.000Z", null),
    ];
    expect(pickReconcileBatch(rows).map((r) => r.id)).toEqual([
      "fresh-older",
      "fresh-newer",
      "queried-old",
      "queried-recent",
    ]);
  });

  it("caps the batch so Daraja's spike arrest is respected, and does not mutate the input", () => {
    const rows = Array.from({ length: 12 }, (_, i) =>
      row(`r${i}`, `2026-10-03T0${i % 10}:00:00.000Z`, null),
    );
    const copy = [...rows];
    expect(pickReconcileBatch(rows)).toHaveLength(RECONCILE_BATCH_SIZE);
    expect(pickReconcileBatch(rows, 2)).toHaveLength(2);
    expect(rows).toEqual(copy);
  });

  it("returns an empty batch for no rows", () => {
    expect(pickReconcileBatch([])).toEqual([]);
  });
});
