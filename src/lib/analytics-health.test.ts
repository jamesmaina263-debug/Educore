import { describe, expect, it } from "vitest";
import { assessAnalyticsHealth } from "./analytics-health";

const base = { gaConfigured: true, gaVisitors: 5, firstPartyVisitors: 6, endsToday: false };

describe("assessAnalyticsHealth", () => {
  it("is ok when both counters have data", () => {
    expect(assessAnalyticsHealth(base)).toEqual({ status: "ok" });
  });
  it("is ok when both are zero", () => {
    expect(assessAnalyticsHealth({ ...base, gaVisitors: 0, firstPartyVisitors: 0 })).toEqual({ status: "ok" });
  });
  it("flags GA4 not configured", () => {
    expect(assessAnalyticsHealth({ ...base, gaConfigured: false, gaVisitors: null }).status).toBe("ga-not-configured");
  });
  it("flags a failed GA4 request", () => {
    expect(assessAnalyticsHealth({ ...base, gaVisitors: null }).status).toBe("ga-error");
  });
  it("flags an unavailable first-party counter", () => {
    expect(assessAnalyticsHealth({ ...base, firstPartyVisitors: null }).status).toBe("counter-unavailable");
  });
  it("treats GA4 zero vs our visitors as lag when the range includes today", () => {
    const h = assessAnalyticsHealth({ ...base, gaVisitors: 0, firstPartyVisitors: 1, endsToday: true });
    expect(h.status).toBe("ga-lagging");
    expect("message" in h && h.message).toContain("1 visitor ");
  });
  it("treats GA4 zero vs our visitors as missing hits for a finished range", () => {
    expect(assessAnalyticsHealth({ ...base, gaVisitors: 0, firstPartyVisitors: 4, endsToday: false }).status).toBe("ga-missing");
  });
  it("stays quiet when GA4 has more than our counter", () => {
    expect(assessAnalyticsHealth({ ...base, gaVisitors: 9, firstPartyVisitors: 0 })).toEqual({ status: "ok" });
  });
});
