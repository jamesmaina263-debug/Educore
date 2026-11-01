import { describe, expect, it } from "vitest";
import { isValidMpesaCode, normalizeMpesaCode, parseMpesaCodeResult, verdictMessage } from "./mpesa-code-check";

describe("mpesa code check helpers", () => {
  it("normalises case and whitespace", () => {
    expect(normalizeMpesaCode(" uk10 30frw6 ")).toBe("UK1030FRW6");
  });

  it("accepts 8 to 16 alphanumerics and rejects the rest", () => {
    expect(isValidMpesaCode("UK1030FRW6")).toBe(true);
    expect(isValidMpesaCode("uk1030 frw6")).toBe(true);
    expect(isValidMpesaCode("abc")).toBe(false);
    expect(isValidMpesaCode("UK1030-FRW6")).toBe(false);
    expect(isValidMpesaCode("A".repeat(17))).toBe(false);
    expect(isValidMpesaCode("")).toBe(false);
  });

  it("has a message for every verdict", () => {
    expect(verdictMessage("recorded")).toMatch(/^Recorded/);
    expect(verdictMessage("seen_not_recorded")).toMatch(/^Seen but not recorded/);
    expect(verdictMessage("not_found")).toMatch(/^Not found/);
  });

  it("parses a valid payload and defaults missing arrays", () => {
    const r = parseMpesaCodeResult({ code: "UK1030FRW6", verdict: "not_found" });
    expect(r).toEqual({ code: "UK1030FRW6", verdict: "not_found", payments: [], statement_lines: [], c2b_events: [], c2b_checked: false });
  });

  it("rejects malformed payloads", () => {
    expect(parseMpesaCodeResult(null)).toBeNull();
    expect(parseMpesaCodeResult("x")).toBeNull();
    expect(parseMpesaCodeResult({ code: "UK1030FRW6", verdict: "weird" })).toBeNull();
    expect(parseMpesaCodeResult({ verdict: "recorded" })).toBeNull();
  });
});
