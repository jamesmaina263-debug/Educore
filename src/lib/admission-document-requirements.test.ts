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

import { isCustomCategory, makeCustomCategory, DEFAULT_REQUIREMENT_CATEGORIES } from "./admission-document-requirements";

describe("makeCustomCategory", () => {
  it("builds a storage-safe key that passes the database pattern", () => {
    const key = makeCustomCategory("Immunization Card (Kenya)!");
    expect(key).toMatch(/^custom_immunization_card_kenya_[a-z0-9]{4}$/);
    expect(isCustomCategory(key)).toBe(true);
  });
  it("never produces slashes or dots, even from hostile input", () => {
    const key = makeCustomCategory("../../etc/passwd");
    expect(key).not.toMatch(/[./\\]/);
    expect(isCustomCategory(key)).toBe(true);
  });
  it("falls back for labels with no usable characters and handles accents", () => {
    expect(makeCustomCategory("???")).toMatch(/^custom_document_/);
    expect(makeCustomCategory("Cértificat")).toMatch(/^custom_certificat_/);
  });
  it("stays within the 60-char limit", () => {
    expect(makeCustomCategory("x".repeat(200)).length).toBeLessThanOrEqual(66);
    expect(isCustomCategory(makeCustomCategory("x".repeat(200)))).toBe(true);
  });
});

describe("isCustomCategory", () => {
  it("does not treat built-in categories as custom", () => {
    for (const c of DEFAULT_REQUIREMENT_CATEGORIES) expect(isCustomCategory(c)).toBe(false);
  });
});
