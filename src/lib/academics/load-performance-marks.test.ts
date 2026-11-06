import { describe, expect, it } from "vitest";
import { mapRows } from "./load-performance-marks";
import { buildYearlySeries, normaliseMarks } from "./performance-analytics";

const year = { id: "y1", name: "2026", start_date: "2026-01-05" };
const exams = { name: "CAT 1", terms: { term_number: 2, academic_years: year } };
const base = { student_id: "s1", class_id: "c1", subject_id: "m", exam_id: "e1", subjects: { name: "Maths" }, classes: { name: "Grade 4" } };

describe("mapRows", () => {
  it("maps a numeric mark with its paper maximum", () => {
    const { marks, skipped } = mapRows([{ ...base, raw_score: 40, band_id: null, exam_subjects: { max_score: 50 }, grading_scale_bands: null, exams }], new Map());
    expect(skipped).toBe(0);
    expect(marks[0]).toMatchObject({ kind: "percent", rawScore: 40, maxScore: 50, termNumber: 2, yearName: "2026", classLabel: "Grade 4", examName: "CAT 1" });
    expect(normaliseMarks(marks)[0].score).toBe(80);
  });

  it("maps a CBC band mark using the scale's level count, reading numeric strings from Postgres", () => {
    const band = { label: "B — Meeting Expectation", points: null, level_order: 2, grading_scale_id: "g1" };
    const { marks } = mapRows([{ ...base, raw_score: null, band_id: "b2", exam_subjects: null, grading_scale_bands: band, exams }], new Map([["g1", 4]]));
    expect(marks[0]).toMatchObject({ kind: "level", levelOrder: 2, levelCount: 4, levelPoints: null, levelLabel: "B — Meeting Expectation" });
    expect(normaliseMarks(marks)[0].score).toBe(3);

    const withPoints = { ...band, points: "2.50" };
    const { marks: m2 } = mapRows([{ ...base, raw_score: null, band_id: "b2", exam_subjects: null, grading_scale_bands: withPoints, exams }], new Map([["g1", 4]]));
    expect(normaliseMarks(m2)[0].score).toBe(2.5);
  });

  it("counts, rather than hides, rows it cannot place", () => {
    const rows = [
      { ...base, raw_score: 50, band_id: null, exam_subjects: { max_score: 100 }, grading_scale_bands: null, exams: { name: "x", terms: null } }, // term/year unreadable
      { ...base, raw_score: null, band_id: "b1", exam_subjects: null, grading_scale_bands: { label: "A", points: null, level_order: 1, grading_scale_id: "unknown" }, exams }, // scale size unknown
      { ...base, raw_score: 70, band_id: null, exam_subjects: { max_score: 100 }, grading_scale_bands: null, exams }, // fine
    ];
    const { marks, skipped } = mapRows(rows, new Map());
    expect(marks).toHaveLength(1);
    expect(skipped).toBe(2);
  });

  it("builds one year from mixed arrays and single objects the way PostgREST returns them", () => {
    const rows = [
      { ...base, raw_score: 60, band_id: null, exam_subjects: [{ max_score: 100 }], grading_scale_bands: null, exams: [{ name: "CAT", terms: [{ term_number: 1, academic_years: [year] }] }] },
      { ...base, exam_id: "e2", raw_score: 80, band_id: null, exam_subjects: { max_score: 100 }, grading_scale_bands: null, exams },
    ];
    const { marks } = mapRows(rows, new Map());
    const y = buildYearlySeries(normaliseMarks(marks));
    expect(y).toHaveLength(1);
    expect(y[0].average).toBe(70);
  });
});
