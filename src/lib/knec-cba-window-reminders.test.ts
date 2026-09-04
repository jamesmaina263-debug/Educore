import { describe, expect, it } from "vitest";
import {
  classNameMatchesGradeLabels,
  daysUntil,
  urgencyFor,
  buildKnecCbaWindowReminders,
  type KnecCbaAssessmentWindow,
} from "./knec-cba-window-reminders";

function win(overrides: Partial<KnecCbaAssessmentWindow>): KnecCbaAssessmentWindow {
  return {
    id: "w1",
    title: "Grade 4/5 Term 3 CBA Upload",
    gradeLabels: ["Grade 4", "Grade 5"],
    opensAt: null,
    closesAt: "2026-10-23",
    notes: null,
    sourceUrl: null,
    ...overrides,
  };
}

describe("classNameMatchesGradeLabels", () => {
  it("matches when a grade label is a substring of the class name", () => {
    expect(classNameMatchesGradeLabels("Grade 4 North", ["Grade 4", "Grade 5"])).toBe(true);
    expect(classNameMatchesGradeLabels("Grade 5 East", ["Grade 4", "Grade 5"])).toBe(true);
  });

  it("does not match an unrelated grade", () => {
    expect(classNameMatchesGradeLabels("Grade 9 North", ["Grade 4", "Grade 5"])).toBe(false);
  });

  it("is case-insensitive", () => {
    expect(classNameMatchesGradeLabels("grade 4 north", ["Grade 4"])).toBe(true);
  });

  it("treats null or empty grade labels as applying to every class", () => {
    expect(classNameMatchesGradeLabels("Grade 1 West", null)).toBe(true);
    expect(classNameMatchesGradeLabels("Grade 1 West", [])).toBe(true);
  });
});

describe("daysUntil / urgencyFor", () => {
  const today = new Date(2026, 8, 20); // Sep 20, 2026

  it("computes whole days remaining", () => {
    expect(daysUntil("2026-09-23", today)).toBe(3);
    expect(daysUntil("2026-09-20", today)).toBe(0);
  });

  it("computes a negative count once past the deadline", () => {
    expect(daysUntil("2026-09-17", today)).toBe(-3);
  });

  it("classifies urgency by days remaining", () => {
    expect(urgencyFor(-1)).toBe("overdue");
    expect(urgencyFor(0)).toBe("urgent");
    expect(urgencyFor(3)).toBe("urgent");
    expect(urgencyFor(4)).toBe("soon");
    expect(urgencyFor(14)).toBe("soon");
    expect(urgencyFor(15)).toBe("upcoming");
  });
});

describe("buildKnecCbaWindowReminders", () => {
  const today = new Date(2026, 8, 20); // Sep 20, 2026

  it("includes a window only for a school with a matching class", () => {
    const windows = [win({ id: "w1", gradeLabels: ["Grade 4"] })];
    expect(buildKnecCbaWindowReminders(windows, ["Grade 9 North"], new Set(), today)).toHaveLength(0);
    expect(buildKnecCbaWindowReminders(windows, ["Grade 4 North"], new Set(), today)).toHaveLength(1);
  });

  it("includes an ungraded (applies-to-all) window for any school", () => {
    const windows = [win({ id: "w1", gradeLabels: null })];
    expect(buildKnecCbaWindowReminders(windows, ["Grade 2 East"], new Set(), today)).toHaveLength(1);
  });

  it("excludes a dismissed window", () => {
    const windows = [win({ id: "w1", gradeLabels: null })];
    expect(buildKnecCbaWindowReminders(windows, ["Grade 2 East"], new Set(["w1"]), today)).toHaveLength(0);
  });

  it("drops a window once it's more than the grace period past its deadline", () => {
    const windows = [win({ id: "w1", gradeLabels: null, closesAt: "2026-09-01" })];
    expect(buildKnecCbaWindowReminders(windows, ["Grade 2 East"], new Set(), today)).toHaveLength(0);
  });

  it("keeps a window that only just closed, within the grace period", () => {
    const windows = [win({ id: "w1", gradeLabels: null, closesAt: "2026-09-18" })];
    const result = buildKnecCbaWindowReminders(windows, ["Grade 2 East"], new Set(), today);
    expect(result).toHaveLength(1);
    expect(result[0].urgency).toBe("overdue");
  });

  it("sorts soonest-closing first", () => {
    const windows = [
      win({ id: "later", gradeLabels: null, closesAt: "2026-11-01" }),
      win({ id: "sooner", gradeLabels: null, closesAt: "2026-09-25" }),
    ];
    const result = buildKnecCbaWindowReminders(windows, ["Grade 2 East"], new Set(), today);
    expect(result.map((r) => r.window.id)).toEqual(["sooner", "later"]);
  });
});
