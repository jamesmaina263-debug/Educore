import { describe, expect, it } from "vitest";
import { LEARNER_COLUMNS, MARK_COLUMNS, columnsFor, isReportDataset, learnerRecord, markRecord, toCsvRows, validateColumns } from "./custom-report";

describe("datasets and columns", () => {
  it("knows the two datasets and their columns", () => {
    expect(isReportDataset("learners")).toBe(true);
    expect(isReportDataset("marks")).toBe(true);
    expect(isReportDataset("payments")).toBe(false);
    expect(columnsFor("learners")).toBe(LEARNER_COLUMNS);
    expect(columnsFor("marks")).toBe(MARK_COLUMNS);
  });
  it("offers no sensitive learner fields", () => {
    const keys = LEARNER_COLUMNS.map((c) => c.key).join(",");
    for (const banned of ["birth", "upi", "date_of_birth", "phone", "guardian", "photo", "nemis"]) expect(keys).not.toContain(banned);
  });
  it("validates columns against the whitelist, keeping order and dropping duplicates", () => {
    const ok = validateColumns("learners", ["last_name", "admission_number", "last_name"]);
    expect("columns" in ok && ok.columns.map((c) => c.key)).toEqual(["last_name", "admission_number"]);
  });
  it("rejects unknown, wrong-dataset, empty and non-array columns", () => {
    expect(validateColumns("learners", ["date_of_birth"])).toHaveProperty("error");
    expect(validateColumns("learners", ["score"])).toHaveProperty("error");
    expect(validateColumns("marks", [])).toHaveProperty("error");
    expect(validateColumns("marks", "score")).toHaveProperty("error");
    expect(validateColumns("marks", [5])).toHaveProperty("error");
  });
});

describe("records", () => {
  it("builds a learner record with the class label", () => {
    const r = learnerRecord({
      admission_number: "12", first_name: "Amy", other_names: null, last_name: "Abel", gender: "F", status: "active", admission_date: "2026-01-05",
      streams: { name: "A", classes: { name: "Grade 6" } },
    });
    expect(r).toMatchObject({ admission_number: "12", first_name: "Amy", other_names: "", class: "Grade 6 A", status: "active" });
  });
  it("copes with array-shaped joins and missing data", () => {
    const r = learnerRecord({ admission_number: null, first_name: null, other_names: null, last_name: null, gender: null, status: null, admission_date: null, streams: [{ name: "B", classes: [{ name: "Grade 7" }] }] });
    expect(r.class).toBe("Grade 7 B");
    expect(r.first_name).toBe("");
    expect(learnerRecord({ admission_number: "1", first_name: "A", other_names: null, last_name: "B", gender: null, status: null, admission_date: null }).class).toBe("");
  });
  it("builds a mark record with learner name, subject, numeric score and grade", () => {
    const r = markRecord({
      raw_score: "78.50", subjects: { name: "Maths" }, grading_scale_bands: { label: "B" }, exams: { name: "Mid-term" },
      students: { admission_number: "12", first_name: "Amy", other_names: "Wanjiru", last_name: "Abel", streams: { name: "A", classes: { name: "Grade 6" } } },
    });
    expect(r).toEqual({ exam: "Mid-term", class: "Grade 6 A", admission_number: "12", learner: "Amy Wanjiru Abel", subject: "Maths", score: "78.5", grade: "B" });
    expect(markRecord({ raw_score: null }).score).toBe("");
  });
});

describe("toCsvRows", () => {
  it("keeps only the chosen columns, labelled, in order", () => {
    const rows = toCsvRows([{ admission_number: "1", last_name: "Abel", gender: "F" }], [LEARNER_COLUMNS[3], LEARNER_COLUMNS[0]]);
    expect(rows).toEqual([{ "Last name": "Abel", "Admission number": "1" }]);
  });
  it("defuses spreadsheet formulas in any cell", () => {
    const rows = toCsvRows([{ last_name: "=HYPERLINK(\"http://x\")", first_name: "@cmd", other_names: "+1", admission_number: "-2" }], [LEARNER_COLUMNS[3], LEARNER_COLUMNS[1], LEARNER_COLUMNS[2], LEARNER_COLUMNS[0]]);
    for (const v of Object.values(rows[0])) expect(v.startsWith("'")).toBe(true);
  });
});
