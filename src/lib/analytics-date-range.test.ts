import { describe, expect, it } from "vitest";
import {
  ANALYTICS_TIME_ZONE,
  dayEndUtc,
  dayStartUtc,
  priorPeriod,
  resolveDateRange,
  todayIso,
} from "./analytics-date-range";

// 2026-10-16 22:30 UTC is 2026-10-17 01:30 in Nairobi (UTC+3): the window where the two zones
// disagree about the date, which is exactly when "Today" used to ask GA4 for yesterday.
const lateEveningUtc = new Date("2026-10-16T22:30:00Z");
const nairobi = { timeZone: ANALYTICS_TIME_ZONE, now: lateEveningUtc };

describe("analytics date ranges", () => {
  it("defaults to UTC so existing callers keep their behaviour", () => {
    expect(todayIso(undefined, lateEveningUtc)).toBe("2026-10-16");
    expect(resolveDateRange("today", undefined, { now: lateEveningUtc }).startIso).toBe("2026-10-16");
  });

  it("uses Nairobi's calendar day when asked", () => {
    expect(todayIso(ANALYTICS_TIME_ZONE, lateEveningUtc)).toBe("2026-10-17");
    const today = resolveDateRange("today", undefined, nairobi);
    expect(today).toMatchObject({ startIso: "2026-10-17", endIso: "2026-10-17" });
  });

  it("derives yesterday and rolling windows from the Nairobi day", () => {
    expect(resolveDateRange("yesterday", undefined, nairobi)).toMatchObject({
      startIso: "2026-10-16",
      endIso: "2026-10-16",
    });
    expect(resolveDateRange("7d", undefined, nairobi)).toMatchObject({ startIso: "2026-10-11", endIso: "2026-10-17" });
    expect(resolveDateRange("30d", undefined, nairobi)).toMatchObject({ startIso: "2026-09-18", endIso: "2026-10-17" });
    expect(resolveDateRange("90d", undefined, nairobi)).toMatchObject({ startIso: "2026-07-20", endIso: "2026-10-17" });
  });

  it("agrees with UTC outside the 00:00-03:00 Nairobi window", () => {
    const noon = new Date("2026-10-17T12:00:00Z");
    expect(todayIso(ANALYTICS_TIME_ZONE, noon)).toBe(todayIso("UTC", noon));
  });

  it("passes custom ranges through unchanged", () => {
    expect(resolveDateRange("custom", { from: "2026-10-01", to: "2026-10-05" }, nairobi)).toMatchObject({
      startIso: "2026-10-01",
      endIso: "2026-10-05",
    });
  });

  it("computes the equivalent prior period", () => {
    expect(priorPeriod("2026-10-11", "2026-10-17")).toEqual({ startIso: "2026-10-04", endIso: "2026-10-10" });
  });

  it("converts a Nairobi calendar day to UTC bounds for database filters", () => {
    expect(dayStartUtc("2026-10-17")).toBe("2026-10-16T21:00:00.000Z");
    expect(dayEndUtc("2026-10-17")).toBe("2026-10-17T20:59:59.999Z");
  });
});
