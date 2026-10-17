import { describe, expect, it } from "vitest";
import { validateRequirementLabel } from "./admission-document-requirements";

describe("validateRequirementLabel", () => {
  it("trims and collapses whitespace", () => {
    expect(validateRequirementLabel("  Birth   Certificate ")).toEqual({ ok: true, value: "Birth Certificate" });
  });
  it("rejects blank and over-long names", () => {
    expect(validateRequirementLabel("   ").ok).toBe(false);
    expect(validateRequirementLabel("x".repeat(61)).ok).toBe(false);
  });
});
