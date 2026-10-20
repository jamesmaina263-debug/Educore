import { describe, expect, it } from "vitest";
import { funnelRows, parseTrialFunnel } from "./trial-funnel";

const raw = {
  from: "2026-09-19",
  to: "2026-10-19",
  site_visitors: "15",
  signup_visitors: 3,
  trials_started: 3,
  activation: { cohort_schools: 3, with_students: 0, with_fee_structure: 0, with_invoice: 0, with_second_user: 2, set_up_basics: 0 },
};

describe("parseTrialFunnel", () => {
  it("coerces numbers and maps fields", () => {
    const f = parseTrialFunnel(raw)!;
    expect(f).toMatchObject({ siteVisitors: 15, signupVisitors: 3, trialsStarted: 3 });
    expect(f.activation).toMatchObject({ cohortSchools: 3, withSecondUser: 2 });
  });
  it("turns missing or bad values into zeros", () => {
    const f = parseTrialFunnel({ site_visitors: "x", signup_visitors: -4 })!;
    expect(f.siteVisitors).toBe(0);
    expect(f.signupVisitors).toBe(0);
    expect(f.activation.cohortSchools).toBe(0);
  });
  it("rejects non-objects", () => {
    expect(parseTrialFunnel(null)).toBeNull();
    expect(parseTrialFunnel([])).toBeNull();
    expect(parseTrialFunnel("nope")).toBeNull();
  });
});

describe("funnelRows", () => {
  it("computes step rates and never divides by zero", () => {
    const { journey, setup } = funnelRows(parseTrialFunnel(raw)!);
    expect(journey[0].ofPrevious).toBeNull();
    expect(journey[1].ofPrevious).toBe("20.0%");
    expect(journey[2].ofPrevious).toBe("100.0%");
    expect(setup[3].ofPrevious).toBe("66.7%");
    const empty = funnelRows(parseTrialFunnel({})!);
    expect(empty.journey.every((r) => r.ofPrevious === null)).toBe(true);
    expect(empty.setup.every((r) => r.ofPrevious === null)).toBe(true);
  });
});
