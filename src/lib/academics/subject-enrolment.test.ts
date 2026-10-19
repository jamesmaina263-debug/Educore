import { describe, it, expect } from "vitest";
import { buildSubjectEnrolment, EVERYONE_TAKES_EVERYTHING, type EnrolmentRow } from "./subject-enrolment";

const row = (studentId: string, subjectId: string, isActive = true): EnrolmentRow => ({ studentId, subjectId, isActive });

describe("buildSubjectEnrolment", () => {
  it("with no rows everyone takes everything, exactly as before the table existed", () => {
    const e = buildSubjectEnrolment([]);
    expect(e).toBe(EVERYONE_TAKES_EVERYTHING);
    expect(e.takes("any-student", "any-subject")).toBe(true);
    expect(e.isSelective("any-subject")).toBe(false);
  });

  it("a subject with rows is selective: only students with an active row take it", () => {
    const e = buildSubjectEnrolment([row("1", "physics", true), row("2", "physics", false)]);
    expect(e.isSelective("physics")).toBe(true);
    expect(e.takes("1", "physics")).toBe(true);
    expect(e.takes("2", "physics")).toBe(false); // explicit inactive row
    expect(e.takes("3", "physics")).toBe(false); // no row at all
  });

  it("a selective subject with nobody ticked is still selective, not universal again", () => {
    const e = buildSubjectEnrolment([row("1", "physics", false), row("2", "physics", false)]);
    expect(e.isSelective("physics")).toBe(true);
    expect(e.takes("1", "physics")).toBe(false);
    expect(e.takes("2", "physics")).toBe(false);
  });

  it("subjects without rows stay universal even when another subject is selective", () => {
    const e = buildSubjectEnrolment([row("1", "physics", true)]);
    expect(e.isSelective("maths")).toBe(false);
    expect(e.takes("1", "maths")).toBe(true);
    expect(e.takes("2", "maths")).toBe(true);
  });

  it("an existing mark always counts as taking the subject, so history is never hidden", () => {
    const e = buildSubjectEnrolment(
      [row("1", "physics", true), row("2", "physics", false)],
      [
        { studentId: "2", subjectId: "physics" }, // inactive row but already marked
        { studentId: "3", subjectId: "physics" }, // no row but already marked
      ],
    );
    expect(e.takes("2", "physics")).toBe(true);
    expect(e.takes("3", "physics")).toBe(true);
    expect(e.takes("4", "physics")).toBe(false);
  });

  it("a mark in one subject does not make the student take a different selective subject", () => {
    const e = buildSubjectEnrolment([row("1", "physics", true), row("1", "art", true)], [{ studentId: "2", subjectId: "art" }]);
    expect(e.takes("2", "art")).toBe(true);
    expect(e.takes("2", "physics")).toBe(false);
  });

  it("marks have no effect on a universal subject", () => {
    const e = buildSubjectEnrolment([row("1", "physics", true)], [{ studentId: "9", subjectId: "maths" }]);
    expect(e.takes("9", "maths")).toBe(true);
    expect(e.takes("8", "maths")).toBe(true);
  });
});
