import { describe, expect, it } from "vitest";
import {
  addDays,
  classifyCoverage,
  combineCoverage,
  compareUrgency,
  entryDueDate,
  groupCoverage,
  isEntryDue,
  nairobiToday,
  pickDefaultTerm,
  summariseScheme,
  type CoverageEntry,
} from "./scheme-coverage";

// Term starts Monday 2027-01-04. Week 1 = 4-10 Jan, week 2 = 11-17 Jan, week 3 = 18-24 Jan ...
const START = "2027-01-04";

function lesson(week: number, done: boolean, entry_date: string | null = null): CoverageEntry {
  return { week_number: week, entry_date, completion_status: done ? "completed" : "pending" };
}

describe("dates", () => {
  it("adds days across month and year boundaries", () => {
    expect(addDays("2026-12-31", 1)).toBe("2027-01-01");
    expect(addDays("2027-03-01", -1)).toBe("2027-02-28");
    expect(addDays("2028-02-28", 1)).toBe("2028-02-29");
  });

  it("rejects malformed dates instead of guessing", () => {
    expect(() => addDays("2027-1-4", 1)).toThrow();
    expect(() => addDays("", 1)).toThrow();
  });

  it("gives Nairobi's calendar day, not the server's", () => {
    // 22:30 UTC on the 16th is already 01:30 on the 17th in Nairobi (UTC+3).
    expect(nairobiToday(new Date("2026-10-16T22:30:00Z"))).toBe("2026-10-17");
    expect(nairobiToday(new Date("2026-10-16T20:59:00Z"))).toBe("2026-10-16");
  });
});

describe("due dates", () => {
  it("defaults to the last day of the planned week, counted from term start", () => {
    expect(entryDueDate(lesson(1, false), START)).toBe("2027-01-10");
    expect(entryDueDate(lesson(2, false), START)).toBe("2027-01-17");
    expect(entryDueDate(lesson(13, false), START)).toBe("2027-04-04");
  });

  it("prefers a date the teacher set on the lesson", () => {
    expect(entryDueDate(lesson(1, false, "2027-01-06"), START)).toBe("2027-01-06");
  });

  it("ignores a malformed entry_date and falls back to the week", () => {
    expect(entryDueDate(lesson(1, false, "not-a-date"), START)).toBe("2027-01-10");
  });

  it("treats week 0 or negative as week 1 rather than a date before the term", () => {
    expect(entryDueDate(lesson(0, false), START)).toBe("2027-01-10");
    expect(entryDueDate(lesson(-3, false), START)).toBe("2027-01-10");
  });

  it("is due only after the due date has passed, so the current week is never flagged late", () => {
    expect(isEntryDue(lesson(1, false), START, "2027-01-10")).toBe(false); // last day of week 1
    expect(isEntryDue(lesson(1, false), START, "2027-01-11")).toBe(true);
  });
});

describe("classifyCoverage", () => {
  it("uses the 90% and 60% thresholds on due lessons", () => {
    expect(classifyCoverage(10, 10, 9)).toBe("on_track"); // 90%
    expect(classifyCoverage(10, 10, 8)).toBe("behind"); // 80%
    expect(classifyCoverage(10, 10, 6)).toBe("behind"); // 60%
    expect(classifyCoverage(10, 10, 5)).toBe("critical"); // 50%
  });

  it("separates 'nothing planned' from 'nothing due yet'", () => {
    expect(classifyCoverage(0, 0, 0)).toBe("no_lessons");
    expect(classifyCoverage(8, 0, 0)).toBe("not_due");
  });
});

describe("summariseScheme", () => {
  const scheme = [
    lesson(1, true),
    lesson(1, true),
    lesson(1, false),
    lesson(2, true),
    lesson(2, false),
    lesson(3, true), // done early, not due yet
    lesson(3, false),
  ];

  it("counts due lessons and how many of them are done", () => {
    // On 2027-01-18 weeks 1 and 2 have ended (5 lessons due); week 3 ends 24 Jan.
    const c = summariseScheme(scheme, START, "2027-01-18");
    expect(c).toMatchObject({ total: 7, completed: 4, due: 5, dueCompleted: 3, lag: 2 });
    expect(c.dueRatio).toBeCloseTo(0.6);
    expect(c.status).toBe("behind");
  });

  it("does not penalise lessons ticked ahead of schedule", () => {
    const c = summariseScheme([lesson(1, true), lesson(5, true), lesson(6, true)], START, "2027-01-11");
    expect(c).toMatchObject({ total: 3, completed: 3, due: 1, dueCompleted: 1, lag: 0 });
    expect(c.status).toBe("on_track");
  });

  it("reports 'not started' before the term begins, with no lag", () => {
    const c = summariseScheme(scheme, START, "2026-11-01");
    expect(c).toMatchObject({ due: 0, dueCompleted: 0, lag: 0, dueRatio: null, status: "not_due" });
  });

  it("flags a scheme with no lessons", () => {
    expect(summariseScheme([], START, "2027-02-01").status).toBe("no_lessons");
  });

  it("marks a scheme far behind when little of what is due is done", () => {
    const entries = [lesson(1, false), lesson(1, false), lesson(2, false), lesson(2, true)];
    const c = summariseScheme(entries, START, "2027-02-01");
    expect(c).toMatchObject({ due: 4, dueCompleted: 1, lag: 3, status: "critical" });
  });

  it("uses a lesson's own date over its week when deciding if it is due", () => {
    // Planned for week 5 but dated 6 Jan: due by 2027-01-11 even though week 5 is far off.
    const c = summariseScheme([lesson(5, false, "2027-01-06")], START, "2027-01-11");
    expect(c).toMatchObject({ due: 1, dueCompleted: 0, status: "critical" });
  });
});

describe("combineCoverage, compareUrgency and groupCoverage", () => {
  const today = "2027-01-18";
  const onTrack = summariseScheme([lesson(1, true), lesson(2, true)], START, today);
  const behind = summariseScheme([lesson(1, true), lesson(1, false), lesson(2, true)], START, today); // 2/3
  const critical = summariseScheme([lesson(1, false), lesson(2, false), lesson(2, false)], START, today); // 0/3

  it("re-classifies the combined totals rather than averaging statuses", () => {
    const all = combineCoverage([onTrack, behind, critical]);
    expect(all).toMatchObject({ total: 8, due: 8, dueCompleted: 4, lag: 4 });
    expect(all.status).toBe("critical"); // 50% overall
  });

  it("orders most urgent first, then by lessons outstanding", () => {
    const sorted = [onTrack, critical, behind].sort(compareUrgency);
    expect(sorted.map((c) => c.status)).toEqual(["critical", "behind", "on_track"]);
    const worse = summariseScheme([lesson(1, false), lesson(1, false), lesson(2, false), lesson(2, false)], START, today);
    expect(compareUrgency(worse, critical)).toBeLessThan(0); // same status, bigger lag first
  });

  it("groups by key and totals each group", () => {
    const groups = groupCoverage([
      { key: "t1", label: "Ms Achieng", coverage: onTrack },
      { key: "t2", label: "Mr Kamau", coverage: critical },
      { key: "t1", label: "Ms Achieng", coverage: behind },
    ]);
    expect(groups.map((g) => g.label)).toEqual(["Mr Kamau", "Ms Achieng"]);
    expect(groups[1]).toMatchObject({ key: "t1", schemes: 2 });
    expect(groups[1].coverage).toMatchObject({ total: 5, due: 5, dueCompleted: 4 });
    expect(groups[1].coverage.status).toBe("behind"); // 80%
  });

  it("returns no groups for no input", () => {
    expect(groupCoverage([])).toEqual([]);
  });
});

describe("pickDefaultTerm", () => {
  const t1 = { id: "t1", start_date: "2027-01-04", end_date: "2027-04-02" };
  const t2 = { id: "t2", start_date: "2027-04-26", end_date: "2027-08-06" };
  const t3 = { id: "t3", start_date: "2027-08-30", end_date: "2027-10-22" };

  it("picks the term containing today", () => {
    expect(pickDefaultTerm([t1, t2, t3], "2027-05-10")?.id).toBe("t2");
  });

  it("between terms, picks the one that just ended", () => {
    expect(pickDefaultTerm([t1, t2, t3], "2027-04-10")?.id).toBe("t1");
  });

  it("before every term, picks the soonest upcoming one", () => {
    expect(pickDefaultTerm([t3, t1, t2], "2026-11-01")?.id).toBe("t1");
  });

  it("returns null when the school has no terms", () => {
    expect(pickDefaultTerm([], "2027-01-01")).toBeNull();
  });
});
