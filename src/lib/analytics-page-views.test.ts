import { describe, expect, it } from "vitest";
import { countryLabel, deviceLabel, parsePageViewSummary } from "./analytics-page-views";

describe("parsePageViewSummary", () => {
  it("coerces and defaults", () => {
    const s = parsePageViewSummary({ from: "2026-10-17", to: "2026-10-17", views: "5", visitors: 2, series: [{ bucket: "09", views: 3, visitors: 1 }], topPages: [{ label: "/", value: 4 }, { label: "", value: 1 }] });
    expect(s).toMatchObject({ views: 5, visitors: 2, adVisits: 0, firstRecordedDay: null });
    expect(s?.topPages).toEqual([{ label: "/", value: 4 }]);
  });
  it("rejects unusable data", () => {
    expect(parsePageViewSummary(null)).toBeNull();
    expect(parsePageViewSummary({ views: 1 })).toBeNull();
  });
});

describe("labels", () => {
  it("names countries and devices", () => {
    expect(countryLabel("KE")).toBe("Kenya");
    expect(countryLabel("??")).toBe("Unknown");
    expect(deviceLabel("mobile")).toBe("Phone");
  });
});
