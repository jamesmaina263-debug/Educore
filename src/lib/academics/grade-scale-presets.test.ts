import { describe, expect, it } from "vitest";
import { GRADE_SCALE_PRESETS, checkBands, describeIssue } from "./grade-scale-presets";

describe("grade scale presets", () => {
  it("ships the A*-G and 9-1 scales", () => {
    expect(GRADE_SCALE_PRESETS.map((p) => p.id)).toEqual(["igcse-a-star-g", "gcse-9-1"]);
    const a = GRADE_SCALE_PRESETS[0].bands.map((b) => b.label);
    expect(a).toEqual(["A*", "A", "B", "C", "D", "E", "F", "G", "U"]);
    const n = GRADE_SCALE_PRESETS[1].bands.map((b) => b.label);
    expect(n).toEqual(["9", "8", "7", "6", "5", "4", "3", "2", "1", "U"]);
  });

  it.each(GRADE_SCALE_PRESETS.map((p) => [p.id, p] as const))("%s has no gaps, overlaps or missing ends", (_id, preset) => {
    expect(checkBands(preset.bands)).toEqual([]);
  });

  it.each(GRADE_SCALE_PRESETS.map((p) => [p.id, p] as const))("%s grades every mark from 0 to 100 in steps of 0.01 exactly once", (_id, preset) => {
    const bands = preset.bands.map((b) => ({ min: Math.round(Number(b.min_score) * 100), max: Math.round(Number(b.max_score) * 100) }));
    for (let c = 0; c <= 10000; c++) {
      const hits = bands.filter((b) => c >= b.min && c <= b.max).length;
      if (hits !== 1) throw new Error(`mark ${c / 100} matched ${hits} bands`);
    }
  });

  it("orders points from highest grade down and fits numeric(5,2)", () => {
    for (const p of GRADE_SCALE_PRESETS) {
      const pts = p.bands.map((b) => Number(b.points));
      expect([...pts].sort((x, y) => y - x)).toEqual(pts);
      for (const b of p.bands) {
        expect(Number(b.max_score)).toBeLessThanOrEqual(100);
        expect(Number(b.min_score)).toBeGreaterThanOrEqual(0);
        expect(b.label.length).toBeLessThanOrEqual(3);
      }
    }
  });

  it("says plainly that the percentages are indicative", () => {
    for (const p of GRADE_SCALE_PRESETS) expect(p.description.toLowerCase()).toContain("indicative");
  });
});

describe("checkBands", () => {
  const b = (label: string, min: string, max: string) => ({ label, min_score: min, max_score: max });

  it("finds the gap the existing KJSEA-style whole-number bands leave", () => {
    const issues = checkBands([b("A", "75", "100"), b("B", "50", "74"), b("C", "0", "49")]);
    expect(issues.filter((i) => i.kind === "gap")).toHaveLength(2);
    expect(describeIssue(issues[0])).toMatch(/no grade/);
  });

  it("finds overlaps, inverted bands and missing ends", () => {
    expect(checkBands([b("A", "50", "100"), b("B", "0", "60")]).some((i) => i.kind === "overlap")).toBe(true);
    expect(checkBands([b("A", "90", "80")]).some((i) => i.kind === "inverted")).toBe(true);
    const ends = checkBands([b("A", "10", "90")]);
    expect(ends.map((i) => i.kind)).toEqual(expect.arrayContaining(["no_zero", "no_hundred"]));
  });

  it("ignores blank rows and returns nothing for an empty scale", () => {
    expect(checkBands([])).toEqual([]);
    expect(checkBands([b("", "", ""), b("A", "", "")])).toEqual([]);
  });

  it("accepts whole-number bands that touch with a 0.01 step", () => {
    expect(checkBands([b("A", "50", "100"), b("B", "0", "49.99")])).toEqual([]);
  });
});
