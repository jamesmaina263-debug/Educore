import { describe, expect, it } from "vitest";
import { INTERNAL_VISITOR_COOKIE, INTERNAL_VISITOR_MAX_AGE_SECONDS, hasInternalVisitorCookie, isInternalVisitorValue } from "./internal-visitor";

describe("isInternalVisitorValue", () => {
  it("only accepts the exact marker", () => {
    expect(isInternalVisitorValue("1")).toBe(true);
    expect(isInternalVisitorValue("true")).toBe(false);
    expect(isInternalVisitorValue("0")).toBe(false);
    expect(isInternalVisitorValue("")).toBe(false);
    expect(isInternalVisitorValue(undefined)).toBe(false);
    expect(isInternalVisitorValue(null)).toBe(false);
  });
  it("uses a stable cookie name and a bounded lifetime", () => {
    expect(INTERNAL_VISITOR_COOKIE).toBe("ec_internal");
    expect(INTERNAL_VISITOR_MAX_AGE_SECONDS).toBe(34_560_000);
  });
});

describe("hasInternalVisitorCookie", () => {
  it("finds the marker among other cookies", () => {
    expect(hasInternalVisitorCookie("a=b; ec_internal=1; c=d")).toBe(true);
    expect(hasInternalVisitorCookie("ec_internal=1")).toBe(true);
  });
  it("ignores other values, similar names and missing headers", () => {
    expect(hasInternalVisitorCookie("ec_internal=0")).toBe(false);
    expect(hasInternalVisitorCookie("xec_internal=1")).toBe(false);
    expect(hasInternalVisitorCookie("a=b")).toBe(false);
    expect(hasInternalVisitorCookie("")).toBe(false);
    expect(hasInternalVisitorCookie(null)).toBe(false);
    expect(hasInternalVisitorCookie(undefined)).toBe(false);
    expect(hasInternalVisitorCookie("novalue; ;;=")).toBe(false);
  });
});
