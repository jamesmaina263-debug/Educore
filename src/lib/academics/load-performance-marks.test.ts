import { describe, expect, it } from "vitest";
import { mapStudentRows, type StudentMarkRow } from "./load-performance-marks";
import { buildYearlySeries, normaliseMarks } from "./performance-analytics";

const row: StudentMarkRow = {
  student_id: "s1", class_id: "c1", class_name: "Grade 4", subject_id: "m", subject_name: "Maths", exam_id: "e1", exam_name: "CAT 1",
  raw_score: null, max_score: null, band_label: null, band_points: null, band_level_order: null, band_scale_id: null, level_count: null,
  term_number: 2, year_id: "y1", year_name: "2026", year_start: "2026-01-05",
};

describe("mapStudentRows", () => {
  it("maps a numeric mark with its paper maximum and reads Postgres numerics sent as strings", () => {
    const { marks, skipped } = mapStudentRows([{ ...row, raw_score: "40.00", max_score: "50.00" }]);
    expect(skipped).toBe(0);
    expect(marks[0]).toMatchObject({ kind: "percent", rawScore: 40, maxScore: 50, termNumber: 2, yearName: "2026", classLabel: "Grade 4", examName: "CAT 1" });
    expect(normaliseMarks(marks)[0].score).toBe(80);
  });

  it("scores a numeric mark by its raw score even though it also carries a derived band", () => {
    // resolve_mark_band stamps a band_id on numeric marks too (here with points 12). Checking the band first
    // would score this as a CBC level; it must stay a percentage.
    const { marks } = mapStudentRows([{ ...row, raw_score: 45, max_score: 50, band_label: "High", band_points: 12, band_level_order: 1, band_scale_id: "gs", level_count: 2 }]);
    expect(marks[0].kind).toBe("percent");
    expect(normaliseMarks(marks)[0].score).toBe(90);
  });

  it("maps a CBC mark (no raw score) as a level using the scale's level count", () => {
    const { marks } = mapStudentRows([{ ...row, band_label: "B — Meeting Expectation", band_level_order: 2, band_scale_id: "g1", level_count: 4 }]);
    expect(marks[0]).toMatchObject({ kind: "level", levelOrder: 2, levelCount: 4, levelPoints: null, levelLabel: "B — Meeting Expectation" });
    expect(normaliseMarks(marks)[0].score).toBe(3);
    const withPoints = mapStudentRows([{ ...row, band_label: "B", band_level_order: 2, band_points: "2.50", band_scale_id: "g1", level_count: 4 }]).marks;
    expect(normaliseMarks(withPoints)[0].score).toBe(2.5);
  });

  it("counts, rather than hides, a level mark whose scale size is unknown", () => {
    const { marks, skipped } = mapStudentRows([{ ...row, band_label: "A", band_level_order: 1, level_count: null }]);
    expect(marks).toHaveLength(0);
    expect(skipped).toBe(1);
  });

  it("builds a multi-year series from numeric and CBC history", () => {
    const { marks } = mapStudentRows([
      { ...row, raw_score: 60, max_score: 100, exam_id: "e1" },
      { ...row, raw_score: 80, max_score: 100, exam_id: "e2" },
    ]);
    const years = buildYearlySeries(normaliseMarks(marks));
    expect(years).toHaveLength(1);
    expect(years[0].average).toBe(70);
  });
});
