import { describe, expect, it } from "vitest";
import {
  isValidTitle,
  isValidSchoolType,
  isValidCycle,
  isValidOwnershipType,
  isValidInstitutionType,
  isValidCountryCode,
  isValidCurrencyCode,
  isValidStartingYear,
  startingYearOptions,
  countryName,
  currencyName,
} from "./institution-reference-data";

describe("institution-reference-data validators", () => {
  it("accepts known values and rejects unknown ones", () => {
    expect(isValidTitle("Dr")).toBe(true);
    expect(isValidTitle("Lord")).toBe(false);

    expect(isValidSchoolType("mixed")).toBe(true);
    expect(isValidSchoolType("male")).toBe(false);

    expect(isValidCycle("junior_secondary")).toBe(true);
    expect(isValidCycle("nursery")).toBe(false);

    expect(isValidOwnershipType("faith_based")).toBe(true);
    expect(isValidOwnershipType("state")).toBe(false);

    expect(isValidInstitutionType("secondary_school")).toBe(true);
    expect(isValidInstitutionType("bootcamp")).toBe(false);

    expect(isValidCountryCode("KE")).toBe(true);
    expect(isValidCountryCode("ZZ")).toBe(false);

    expect(isValidCurrencyCode("KES")).toBe(true);
    expect(isValidCurrencyCode("XXX")).toBe(false);
  });

  it("only offers the current year and the next one", () => {
    const now = new Date("2026-08-30T00:00:00Z");
    const years = startingYearOptions(now);
    expect(years).toEqual([2026, 2027]);
    expect(isValidStartingYear(2028)).toBe(false);
  });

  it("resolves country and currency display names", () => {
    expect(countryName("KE")).toBe("Kenya");
    expect(currencyName("KES")).toMatch(/Kenyan|Shilling/i);
  });

  it("never throws for a malformed code, even though it isn't in our curated list", () => {
    expect(() => countryName("not-a-code")).not.toThrow();
    expect(typeof countryName("not-a-code")).toBe("string");
  });
});
