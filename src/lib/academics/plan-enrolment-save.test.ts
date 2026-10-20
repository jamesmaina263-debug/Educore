import { describe, it, expect } from "vitest";
import { planEnrolmentSave } from "./plan-enrolment-save";

describe("planEnrolmentSave", () => {
  it("refuses a class with no active students", () => {
    expect(planEnrolmentSave([], [])).toMatchObject({ ok: false });
  });

  it("everyone selected means universal again (rows are removed, later admissions are included)", () => {
    expect(planEnrolmentSave(["a", "b"], ["b", "a"])).toEqual({ ok: true, mode: "everyone" });
  });

  it("a partial selection writes an explicit row for every active student", () => {
    expect(planEnrolmentSave(["a", "b", "c"], ["b"])).toEqual({
      ok: true,
      mode: "selected",
      rows: [
        { studentId: "a", isActive: false },
        { studentId: "b", isActive: true },
        { studentId: "c", isActive: false },
      ],
    });
  });

  it("nobody selected is allowed and stays selective", () => {
    expect(planEnrolmentSave(["a", "b"], [])).toEqual({
      ok: true,
      mode: "selected",
      rows: [
        { studentId: "a", isActive: false },
        { studentId: "b", isActive: false },
      ],
    });
  });

  it("rejects ids that are not active students of the class", () => {
    expect(planEnrolmentSave(["a", "b"], ["a", "x"])).toMatchObject({ ok: false });
  });

  it("ignores duplicates in either list", () => {
    expect(planEnrolmentSave(["a", "a", "b"], ["a", "a", "b"])).toEqual({ ok: true, mode: "everyone" });
  });
});
