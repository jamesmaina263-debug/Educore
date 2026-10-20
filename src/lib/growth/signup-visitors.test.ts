import { describe, expect, it } from "vitest";
import { countryLabel, deviceLabel, landedOnSignup, parseSignupVisitors } from "./signup-visitors";

const row = { day: "2026-10-20", first_seen_time: "00:32", signup_time: "00:32", entry_path: "/signup", source: "google.com", campaign: null, country: "AO", device: "desktop", pages: 1 };

describe("parseSignupVisitors", () => {
  it("maps rows", () => {
    const v = parseSignupVisitors({ visitors: [row] })!;
    expect(v).toHaveLength(1);
    expect(v[0]).toMatchObject({ source: "google.com", country: "AO", device: "desktop", pages: 1, campaign: null });
    expect(landedOnSignup(v[0])).toBe(true);
  });
  it("fills defaults and drops malformed rows", () => {
    const v = parseSignupVisitors({ visitors: [{ day: "2026-10-20", pages: "x" }, null, "nope", {}] })!;
    expect(v).toHaveLength(1);
    expect(v[0]).toMatchObject({ source: "Direct", device: "unknown", pages: 0, entryPath: "(unknown)" });
  });
  it("returns an empty list when visitors is missing and null for non-objects", () => {
    expect(parseSignupVisitors({})).toEqual([]);
    expect(parseSignupVisitors(null)).toBeNull();
    expect(parseSignupVisitors([])).toBeNull();
  });
});

describe("labels", () => {
  it("words devices and countries", () => {
    expect(deviceLabel("mobile")).toBe("Phone");
    expect(deviceLabel("???")).toBe("Unknown");
    expect(countryLabel("KE")).toBe("Kenya");
    expect(countryLabel(null)).toBe("—");
    expect(countryLabel("ken")).toBe("—");
  });
});
