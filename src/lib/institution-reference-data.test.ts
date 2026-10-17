import { describe, expect, it } from "vitest";
import {
  COUNTRY_CODES,
  defaultsForCountry,
  isValidCurrencyCode,
  timezoneOptions,
} from "./institution-reference-data";

describe("defaultsForCountry", () => {
  it("defaults Kenya to KES and Africa/Nairobi", () => {
    expect(defaultsForCountry("KE")).toEqual({ currencyCode: "KES", gmtTimezone: "Africa/Nairobi" });
  });

  it("maps regional neighbours to their own currency", () => {
    expect(defaultsForCountry("UG").currencyCode).toBe("UGX");
    expect(defaultsForCountry("TZ").currencyCode).toBe("TZS");
  });

  it("falls back to USD and a valid time zone for unmapped countries", () => {
    const d = defaultsForCountry("BR");
    expect(d.currencyCode).toBe("USD");
    expect(timezoneOptions()).toContain(d.gmtTimezone);
  });

  it("only ever returns values the server-side validation accepts", () => {
    const zones = new Set(timezoneOptions());
    for (const code of COUNTRY_CODES) {
      const d = defaultsForCountry(code);
      expect(isValidCurrencyCode(d.currencyCode)).toBe(true);
      expect(zones.has(d.gmtTimezone)).toBe(true);
    }
  });
});
