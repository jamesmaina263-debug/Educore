import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import {
  attentionLines,
  failedSinceIso,
  isFirstRunOfHour,
  staleCutoffIso,
  summariseStale,
} from "./c2b-attention";

const NOW = new Date("2026-11-01T10:05:00.000Z");


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

describe("client safety", () => {
  it("imports nothing, so a client component can use it (no server-only code in the client bundle)", () => {
    const src = readFileSync(join(process.cwd(), "src/lib/c2b-attention.ts"), "utf8");
    expect(src).not.toMatch(/^\s*import\s/m);
  });
});
