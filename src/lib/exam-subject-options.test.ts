import { describe, expect, it } from "vitest";
import { gradeToBand, subjectAppliesToClass, subjectsForSelectedClasses, type ExamPickerSubject } from "./exam-subject-options";

const subj = (id: string, name: string, grade_band: string | null, class_ids: string[] = []): ExamPickerSubject => ({
  id,
  name,
  grade_band,
  class_ids,
});

describe("gradeToBand", () => {
  it("maps KICD grades to catalogue bands", () => {
    expect(gradeToBand("PP2")).toBe("pre_primary");
    expect(gradeToBand("G3")).toBe("lower_primary");
    expect(gradeToBand("G6")).toBe("upper_primary");
    expect(gradeToBand("G9")).toBe("junior_school");
    expect(gradeToBand("G12")).toBe("senior_school");
    expect(gradeToBand(null)).toBeNull();
    expect(gradeToBand("nonsense")).toBeNull();
  });
});

describe("subjectAppliesToClass", () => {
  it("matches by assignment or band, and falls back to all when the grade is unset", () => {
    const s = subj("1", "Mathematics", "senior_school");
    expect(subjectAppliesToClass(s, { id: "c6", kicd_grade: "G6" })).toBe(false);
    expect(subjectAppliesToClass(subj("1", "Mathematics", "senior_school", ["c6"]), { id: "c6", kicd_grade: "G6" })).toBe(true);
    expect(subjectAppliesToClass(s, { id: "cx", kicd_grade: null })).toBe(true);
  });
});

describe("subjectsForSelectedClasses", () => {
  const subjects = [
    subj("eng", "English", "upper_primary"),
    subj("kis", "Kiswahili", "upper_primary"),
    subj("m-up", "Mathematics", "upper_primary"),
    subj("m-sr", "Mathematics", "senior_school"),
  ];
  const classes = [
    { id: "g6", kicd_grade: "G6" },
    { id: "g10", kicd_grade: "G10" },
    { id: "unset", kicd_grade: null },
  ];

  it("drops the other band's duplicate for a Grade 6 class", () => {
    const out = subjectsForSelectedClasses(subjects, classes, new Set(["g6"]));
    expect(out.map((o) => o.id)).toEqual(["eng", "kis", "m-up"]);
    expect(out.find((o) => o.id === "m-up")?.label).toBe("Mathematics");
  });

  it("prefers the copy assigned in the class when the grade is unset", () => {
    const withAssignment = [...subjects.slice(0, 2), subj("m-up", "Mathematics", "upper_primary", ["unset"]), subjects[3]];
    const out = subjectsForSelectedClasses(withAssignment, classes, new Set(["unset"]));
    expect(out.filter((o) => o.label.startsWith("Mathematics")).map((o) => o.id)).toEqual(["m-up"]);
  });

  it("labels duplicates with their band when they can't be told apart", () => {
    const out = subjectsForSelectedClasses(subjects, classes, new Set(["unset"]));
    const maths = out.filter((o) => o.label.startsWith("Mathematics"));
    expect(maths).toHaveLength(2);
    expect(maths.map((m) => m.label)).toEqual(["Mathematics — Upper primary (G4–6)", "Mathematics — Senior school (G10–12)"]);
  });

  it("returns every active subject when no class is selected", () => {
    expect(subjectsForSelectedClasses(subjects, classes, new Set())).toHaveLength(4);
  });
});
