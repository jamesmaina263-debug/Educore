import { describe, it, expect } from "vitest";
import { planCopyFromLastYear } from "./plan-copy-from-last-year";
import type { EnrolmentRow } from "./subject-enrolment";

const row = (studentId: string, subjectId: string, isActive: boolean): EnrolmentRow => ({ studentId, subjectId, isActive });
const universal = (subjectId: string) => ({ subjectId, selectiveNow: false });

describe("planCopyFromLastYear", () => {
  it("keeps students who took the subject, drops those who did not", () => {
    const plan = planCopyFromLastYear({
      studentIds: ["a", "b", "c"],
      subjects: [universal("phy")],
      previousRows: [row("a", "phy", true), row("b", "phy", false), row("c", "phy", true)],
    });
    expect(plan).toEqual([{ subjectId: "phy", status: "copy", takingIds: ["a", "c"], continuing: 2, dropped: 1, unknown: 0 }]);
  });

  it("includes a student with no row last year instead of leaving them off", () => {
    const plan = planCopyFromLastYear({
      studentIds: ["a", "b", "new"],
      subjects: [universal("phy")],
      previousRows: [row("a", "phy", true), row("b", "phy", false)],
    });
    expect(plan[0]).toMatchObject({ takingIds: ["a", "new"], continuing: 1, dropped: 1, unknown: 1 });
  });

  it("never touches a subject already set up for this class", () => {
    const plan = planCopyFromLastYear({
      studentIds: ["a", "b"],
      subjects: [{ subjectId: "phy", selectiveNow: true }],
      previousRows: [row("a", "phy", true), row("b", "phy", false)],
    });
    expect(plan).toEqual([]);
  });

  it("skips a subject with no data from last year", () => {
    expect(planCopyFromLastYear({ studentIds: ["a"], subjects: [universal("maths")], previousRows: [row("a", "phy", true)] })).toEqual([]);
  });

  it("skips a subject everyone would take anyway (it stays universal)", () => {
    const plan = planCopyFromLastYear({ studentIds: ["a", "b"], subjects: [universal("phy")], previousRows: [row("a", "phy", true), row("b", "phy", true)] });
    expect(plan).toEqual([]);
  });

  it("flags, and does not copy, a subject nobody continues", () => {
    const plan = planCopyFromLastYear({ studentIds: ["a", "b"], subjects: [universal("phy")], previousRows: [row("a", "phy", false), row("b", "phy", false)] });
    expect(plan).toEqual([{ subjectId: "phy", status: "nobody_continues", takingIds: [], continuing: 0, dropped: 2, unknown: 0 }]);
  });

  it("ignores last year's rows for students who are not in this class", () => {
    // "gone" is not in the class; "a" took it, "b" has no row (unknown, included): everyone takes it, so nothing to copy.
    expect(planCopyFromLastYear({ studentIds: ["a", "b"], subjects: [universal("phy")], previousRows: [row("a", "phy", true), row("gone", "phy", false)] })).toEqual([]);
    // "gone" must not be counted as a dropped student in this class.
    const plan = planCopyFromLastYear({ studentIds: ["a", "b"], subjects: [universal("phy")], previousRows: [row("a", "phy", false), row("gone", "phy", true)] });
    expect(plan[0]).toMatchObject({ takingIds: ["b"], dropped: 1, unknown: 1, continuing: 0 });
  });
});
