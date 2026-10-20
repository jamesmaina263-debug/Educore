import { describe, it, expect } from "vitest";
import { buildEnrolmentView } from "./enrolment-view";

describe("buildEnrolmentView", () => {
  it("a subject with no rows is universal: everyone takes it", () => {
    expect(buildEnrolmentView(["m"], ["a", "b"], [])).toEqual([{ subjectId: "m", selective: false, takingIds: ["a", "b"], notSetIds: [] }]);
  });

  it("a selective subject lists active takers and flags students with no row", () => {
    const view = buildEnrolmentView(["p"], ["a", "b", "c"], [
      { studentId: "a", subjectId: "p", isActive: true },
      { studentId: "b", subjectId: "p", isActive: false },
    ]);
    expect(view).toEqual([{ subjectId: "p", selective: true, takingIds: ["a"], notSetIds: ["c"] }]);
  });

  it("ignores rows for students who are not in the roster", () => {
    const view = buildEnrolmentView(["p"], ["a"], [{ studentId: "gone", subjectId: "p", isActive: true }]);
    expect(view[0]).toMatchObject({ selective: true, takingIds: [], notSetIds: ["a"] });
  });
});
