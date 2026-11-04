import { describe, expect, it } from "vitest";
import {
  cleanPhone,
  describeAlertResult,
  isBoardingKind,
  isBusAlertMode,
  isUuid,
  mapBusAlertError,
  parseAlertResult,
  validateDelay,
  validatePhone,
  type BusAlertResult,
} from "./bus-alerts";

const UUID = "11111111-1111-4111-8111-111111111111";
const base: BusAlertResult = { mode: "live", guardians: 3, queued: 1, skippedOptOut: 1, skippedNoPhone: 1, skippedQuietHours: 0, eventId: null };

describe("guards", () => {
  it("recognises uuids, modes and kinds", () => {
    expect(isUuid(UUID)).toBe(true);
    expect(isUuid("x; drop table")).toBe(false);
    expect(isBusAlertMode("test")).toBe(true);
    expect(isBusAlertMode("LIVE")).toBe(false);
    expect(isBoardingKind("dropped_off")).toBe(true);
    expect(isBoardingKind("teleported")).toBe(false);
  });
});

describe("phone", () => {
  it("cleans spaces and hyphens like the database", () => {
    expect(cleanPhone("0712 345-678")).toBe("0712345678");
    expect(cleanPhone("  ")).toBeNull();
    expect(cleanPhone(null)).toBeNull();
  });
  it("accepts 9 to 15 digits with an optional +, rejects the rest", () => {
    expect(validatePhone("0712345678")).toBeNull();
    expect(validatePhone("+254712345678")).toBeNull();
    expect(validatePhone("")).toBeNull();
    expect(validatePhone("12")).toMatch(/9 to 15 digits/);
    expect(validatePhone("07123abc78")).toMatch(/9 to 15 digits/);
    expect(validatePhone("1234567890123456")).toMatch(/9 to 15 digits/);
  });
});

describe("validateDelay", () => {
  it("accepts 5 to 180 whole minutes and a short note", () => {
    expect(validateDelay(5, null)).toBeNull();
    expect(validateDelay(180, "Traffic on the highway")).toBeNull();
  });
  it("rejects out-of-range, fractional and non-numeric minutes", () => {
    for (const m of [4, 181, 20.5, "20", NaN, null]) expect(validateDelay(m, null)).toMatch(/5 to 180/);
  });
  it("rejects a long note or a line break", () => {
    expect(validateDelay(20, "x".repeat(121))).toMatch(/120/);
    expect(validateDelay(20, "a\nb")).toMatch(/line breaks/);
  });
});

describe("parseAlertResult", () => {
  it("parses the function's jsonb", () => {
    expect(parseAlertResult({ mode: "live", guardians: 3, queued: 1, skipped_opt_out: 1, skipped_no_phone: 1, event_id: UUID })).toEqual({ ...base, eventId: UUID });
  });
  it("returns null for anything unexpected and never throws", () => {
    for (const v of [null, undefined, "x", [], { mode: "weird" }, 5]) expect(parseAlertResult(v)).toBeNull();
    expect(parseAlertResult({ mode: "off", queued: -5, guardians: "x" })).toMatchObject({ mode: "off", queued: 0, guardians: 0 });
  });
});

describe("describeAlertResult", () => {
  it("says nothing was sent when off", () => {
    expect(describeAlertResult("delay", { ...base, mode: "off" }, null)).toMatch(/nothing was sent/);
    expect(describeAlertResult("boarded", { ...base, mode: "off" }, null)).toMatch(/no guardian was messaged/);
  });
  it("makes test mode unmistakable and never claims a guardian was reached", () => {
    const t = describeAlertResult("delay", { ...base, mode: "test", queued: 1 }, 1);
    expect(t).toMatch(/TEST MODE/);
    expect(t).toMatch(/test phone only/);
    expect(t).toMatch(/No guardian was messaged/);
    expect(t).toMatch(/3 guardians/);
    expect(describeAlertResult("boarded", { ...base, mode: "test", guardians: 1 }, null)).toMatch(/queued/);
    expect(describeAlertResult("boarded", { ...base, mode: "test", guardians: 1 }, null)).toMatch(/1 guardian\)/);
  });
  it("reports live counts and every kind of skip", () => {
    const s = describeAlertResult("delay", { ...base, skippedQuietHours: 2 }, 1);
    expect(s).toMatch(/1 guardian was messaged/);
    expect(s).toMatch(/1 opted out/);
    expect(s).toMatch(/1 had no phone number/);
    expect(s).toMatch(/2 held for quiet hours/);
  });
});

describe("mapBusAlertError", () => {
  it("maps known codes and hides unknown ones", () => {
    expect(mapBusAlertError("42501")).toMatch(/permission/);
    expect(mapBusAlertError("55000")).toMatch(/switched off/);
    expect(mapBusAlertError("P0001")).toMatch(/10 minutes/);
    expect(mapBusAlertError("P0002")).toMatch(/wasn't found/);
    expect(mapBusAlertError("XX000")).toBe("Something went wrong. Please try again.");
    expect(mapBusAlertError(undefined)).toBe("Something went wrong. Please try again.");
  });
});
