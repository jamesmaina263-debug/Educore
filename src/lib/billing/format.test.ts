import { describe, expect, it } from "vitest";
import { formatDateOnly, formatInstantDate, formatKes, nairobiDateISO, statusLabel, statusTone } from "./format";

describe("formatKes", () => {
  it("omits decimals for whole amounts and groups thousands", () => {
    expect(formatKes(50000)).toBe("KES 50,000");
    expect(formatKes("100")).toBe("KES 100");
    expect(formatKes(0)).toBe("KES 0");
  });
  it("shows two decimals when needed", () => {
    expect(formatKes(626.4)).toBe("KES 626.40");
    expect(formatKes(1234.5)).toBe("KES 1,234.50");
  });
  it("treats null/undefined as zero", () => {
    expect(formatKes(null)).toBe("KES 0");
    expect(formatKes(undefined)).toBe("KES 0");
  });
});

describe("dates", () => {
  it("formats calendar dates without timezone shifting", () => {
    expect(formatDateOnly("2026-08-07")).toBe("07 Aug 2026");
    expect(formatDateOnly("2027-01-01")).toBe("01 Jan 2027");
    expect(formatDateOnly(null)).toBe("—");
  });
  it("renders instants as Nairobi calendar dates (UTC+3)", () => {
    // 21:30 UTC on the 14th is already the 15th in Nairobi.
    expect(formatInstantDate("2026-10-14T21:30:00Z")).toBe("15 Oct 2026");
    expect(formatInstantDate("2026-10-14T20:59:59Z")).toBe("14 Oct 2026");
    expect(nairobiDateISO("2026-10-14T21:30:00Z")).toBe("2026-10-15");
  });
});

describe("status helpers", () => {
  it("labels every status and falls back to the raw value", () => {
    expect(statusLabel("partially_paid")).toBe("Partially paid");
    expect(statusLabel("draft")).toBe("Draft");
    expect(statusLabel("weird")).toBe("weird");
  });
  it("maps statuses to tones", () => {
    expect(statusTone("paid")).toBe("success");
    expect(statusTone("overdue")).toBe("danger");
    expect(statusTone("partially_paid")).toBe("warning");
    expect(statusTone("sent")).toBe("info");
    expect(statusTone("draft")).toBe("neutral");
  });
});
