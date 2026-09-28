import { describe, it, expect } from "vitest";
import { KICD_GRADES, isKicdGrade, kicdGradeLabel } from "./kicd-grade";

describe("kicd-grade", () => {
  it("covers PP1, PP2 and Grade 1-12 (14 levels)", () => {
    expect(KICD_GRADES).toHaveLength(14);
    expect(KICD_GRADES[0].value).toBe("PP1");
    expect(KICD_GRADES[13].value).toBe("G12");
  });
  it("accepts only known values", () => {
    expect(isKicdGrade("G6")).toBe(true);
    expect(isKicdGrade("PP2")).toBe(true);
    expect(isKicdGrade("G13")).toBe(false);
    expect(isKicdGrade("Grade 6")).toBe(false);
    expect(isKicdGrade(null)).toBe(false);
  });
  it("labels values and returns null for unset/unknown", () => {
    expect(kicdGradeLabel("G6")).toBe("Grade 6");
    expect(kicdGradeLabel(null)).toBeNull();
    expect(kicdGradeLabel("nope")).toBeNull();
  });
});
