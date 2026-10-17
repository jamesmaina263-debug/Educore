import { describe, it, expect } from "vitest";
import {
  NEW_SCHOOL_WINDOW_HOURS,
  OUTBOUND_THRESHOLD,
  alertedSchoolIdsFromDetails,
  countBySchool,
  newSchoolCutoff,
  schoolsToAlert,
} from "./trial-outbound-watch";

describe("newSchoolCutoff", () => {
  it("is 24 hours before now", () => {
    const now = new Date("2026-10-17T12:00:00.000Z");
    expect(newSchoolCutoff(now)).toBe("2026-10-16T12:00:00.000Z");
    expect(NEW_SCHOOL_WINDOW_HOURS).toBe(24);
  });
});

describe("countBySchool", () => {
  it("counts rows per school", () => {
    const m = countBySchool([{ school_id: "a" }, { school_id: "b" }, { school_id: "a" }]);
    expect(m.get("a")).toBe(2);
    expect(m.get("b")).toBe(1);
  });
  it("is empty for no rows", () => {
    expect(countBySchool([]).size).toBe(0);
  });
});

describe("alertedSchoolIdsFromDetails", () => {
  it("parses comma-separated ids and ignores bad details", () => {
    const ids = alertedSchoolIdsFromDetails([{ school_ids: "a, b" }, { school_ids: "c" }, null, { school_ids: 5 }, {}]);
    expect([...ids].sort()).toEqual(["a", "b", "c"]);
  });
});

describe("schoolsToAlert", () => {
  const counts = new Map([
    ["quiet", OUTBOUND_THRESHOLD - 1],
    ["edge", OUTBOUND_THRESHOLD],
    ["busy", OUTBOUND_THRESHOLD + 20],
    ["seen", OUTBOUND_THRESHOLD + 5],
  ]);
  it("alerts at or above the threshold, highest volume first", () => {
    expect(schoolsToAlert(counts, new Set()).map((s) => s.schoolId)).toEqual(["busy", "seen", "edge"]);
  });
  it("skips schools already alerted", () => {
    expect(schoolsToAlert(counts, new Set(["seen"])).map((s) => s.schoolId)).toEqual(["busy", "edge"]);
  });
  it("returns nothing when no school qualifies", () => {
    expect(schoolsToAlert(new Map([["a", 1]]), new Set())).toEqual([]);
  });
});
