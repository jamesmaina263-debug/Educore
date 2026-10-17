import { describe, expect, it } from "vitest";
import {
  escapeIlike,
  friendlyAdmissionNumberError,
  normalizeAdmissionNumber,
  validateAdmissionNumber,
} from "./admission-number";

describe("validateAdmissionNumber", () => {
  it.each(["LB/004/2026", "001", "ADM-12.B", "2026_045", "ab 12"])("accepts %s exactly as typed", (v) => {
    expect(validateAdmissionNumber(v)).toEqual({ ok: true, value: v });
  });
  it("trims surrounding whitespace only (matches the DB trigger)", () => {
    expect(validateAdmissionNumber("  LB/001/2026 ")).toEqual({ ok: true, value: "LB/001/2026" });
    expect(normalizeAdmissionNumber("  x ")).toBe("x");
    expect(normalizeAdmissionNumber(null)).toBe("");
  });
  it("rejects blank, over-long and unsupported characters", () => {
    expect(validateAdmissionNumber("   ").ok).toBe(false);
    expect(validateAdmissionNumber("A".repeat(31)).ok).toBe(false);
    expect(validateAdmissionNumber("LB#004").ok).toBe(false);
    expect(validateAdmissionNumber("///").ok).toBe(false);
  });
});

describe("escapeIlike", () => {
  it("makes wildcards literal so ilike acts as case-insensitive equality", () => {
    expect(escapeIlike("LB_001%")).toBe("LB\\_001\\%");
    expect(escapeIlike("a\\b")).toBe("a\\\\b");
  });
});

describe("friendlyAdmissionNumberError", () => {
  it("maps unique-constraint and case-clash errors", () => {
    expect(friendlyAdmissionNumberError('duplicate key value violates unique constraint "students_school_id_admission_number_key"', "LB/004/2026"))
      .toBe("Admission number LB/004/2026 is already assigned to another student in your school.");
    expect(friendlyAdmissionNumberError("conflicts ... (they differ only by letter case).", "lb/1")).toContain("not case-sensitive");
    expect(friendlyAdmissionNumberError("cannot be cleared once assigned")).toContain("cannot be removed");
  });
  it("returns null for unrelated errors so callers keep the original message", () => {
    expect(friendlyAdmissionNumberError("permission denied")).toBeNull();
  });
});
