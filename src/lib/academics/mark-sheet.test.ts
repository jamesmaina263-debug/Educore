import { describe, it, expect } from "vitest";
import { buildMarkSheetRows, type MarkSheetStudent } from "./mark-sheet";

const student = (over: Partial<MarkSheetStudent> = {}): MarkSheetStudent => ({
  full_name: "Ann",
  marks: [],
  average_score: null,
  rank_in_stream: null,
  ...over,
});

describe("buildMarkSheetRows", () => {
  it("shows the raw score for numeric exams", () => {
    const rows = buildMarkSheetRows([student({ marks: [{ subject_name: "Maths", raw_score: 78, band_label: "A" }], average_score: 78, rank_in_stream: 1 })]);
    expect(rows).toEqual([{ Student: "Ann", Maths: 78, Average: 78, Rank: 1 }]);
  });
  it("falls back to the band label for band-graded (CBC) exams instead of a blank cell", () => {
    const rows = buildMarkSheetRows([student({ marks: [{ subject_name: "Mathematics", raw_score: null, band_label: "A — Exceeding Expectation" }] })]);
    expect(rows[0].Mathematics).toBe("A — Exceeding Expectation");
    expect(rows[0].Average).toBe("—");
    expect(rows[0].Rank).toBe("—");
  });
  it("shows a dash when a student has no mark for a subject, keeping columns aligned", () => {
    const rows = buildMarkSheetRows([
      student({ full_name: "A", marks: [{ subject_name: "Maths", raw_score: 50, band_label: null }, { subject_name: "English", raw_score: 60, band_label: null }] }),
      student({ full_name: "B", marks: [{ subject_name: "Maths", raw_score: 40, band_label: null }] }),
    ]);
    expect(Object.keys(rows[1])).toEqual(["Student", "English", "Maths", "Average", "Rank"]);
    expect(rows[1].English).toBe("—");
  });
  it("keeps a real zero score (not treated as missing)", () => {
    const rows = buildMarkSheetRows([student({ marks: [{ subject_name: "Maths", raw_score: 0, band_label: "BE" }] })]);
    expect(rows[0].Maths).toBe(0);
  });
  it("returns no rows for an empty class", () => expect(buildMarkSheetRows([])).toEqual([]));
});
