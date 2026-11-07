import { describe, expect, it } from "vitest";
import {
  attendancePercentage,
  buildEarlyWarnings,
  buildMatrix,
  buildSubjectProgression,
  configFor,
  levelBands,
  levelBandsFromScale,
  levelPoints,
  buildTermAverages,
  buildYearlySeries,
  normaliseMarks,
  summarizeHistory,
  summarizeSchool,
  type GradeBand,
  type PerfMark,
} from "./performance-analytics";

let n = 0;
function mark(p: Partial<PerfMark>): PerfMark {
  return {
    studentId: "s1",
    classId: "c1",
    classLabel: "Grade 1",
    subjectId: "math",
    subjectName: "Mathematics",
    yearId: "y2024",
    yearName: "2024",
    yearStart: "2024-01-01",
    termNumber: 1,
    examId: `e${n++}`,
    kind: "percent",
    rawScore: 50,
    maxScore: 100,
    levelOrder: null,
    levelCount: null,
    levelPoints: null,
    levelLabel: null,
    ...p,
  };
}

const Y = {
  y2022: { yearId: "y2022", yearName: "2022", yearStart: "2022-01-01" },
  y2023: { yearId: "y2023", yearName: "2023", yearStart: "2023-01-01" },
  y2024: { yearId: "y2024", yearName: "2024", yearStart: "2024-01-01" },
};

describe("normaliseMarks", () => {
  it("converts to a percentage of each mark's own maximum", () => {
    const [a, b] = normaliseMarks([mark({ rawScore: 40, maxScore: 50 }), mark({ rawScore: 40, maxScore: 100 })]);
    expect(a.score).toBe(80);
    expect(b.score).toBe(40);
  });

  it("excludes missing marks and unusable maximums instead of counting zero", () => {
    const out = normaliseMarks([
      mark({ rawScore: null }),
      mark({ maxScore: null }),
      mark({ maxScore: 0 }),
      mark({ rawScore: -1 }),
      mark({ rawScore: 0 }),
    ]);
    expect(out).toHaveLength(1);
    expect(out[0].score).toBe(0); // a recorded zero is a real zero
  });
});

describe("buildYearlySeries", () => {
  const marks = normaliseMarks([
    mark({ ...Y.y2022, rawScore: 52 }),
    mark({ ...Y.y2023, rawScore: 60 }),
    mark({ ...Y.y2024, rawScore: 75 }),
  ]);

  it("is chronological and reports change in percentage points", () => {
    const s = buildYearlySeries(marks);
    expect(s.map((p) => p.yearName)).toEqual(["2022", "2023", "2024"]);
    expect(s[0].changeFromPrevious).toBeNull();
    expect(s[1].changeFromPrevious).toBeCloseTo(8);
    expect(s[2].changeFromPrevious).toBeCloseTo(15); // 60% -> 75% is 15 pp, not 15%
  });

  it("orders by year start regardless of input order", () => {
    const s = buildYearlySeries([...marks].reverse());
    expect(s.map((p) => p.yearName)).toEqual(["2022", "2023", "2024"]);
  });

  it("flags years with fewer than three terms as incomplete", () => {
    const full = normaliseMarks([1, 2, 3].map((t) => mark({ termNumber: t })));
    expect(buildYearlySeries(full)[0].incomplete).toBe(false);
    expect(buildYearlySeries(marks)[0].incomplete).toBe(true);
  });

  it("averages only valid assessments", () => {
    const s = buildYearlySeries(normaliseMarks([mark({ rawScore: 80 }), mark({ rawScore: null }), mark({ rawScore: 60 })]));
    expect(s[0].average).toBe(70);
    expect(s[0].assessments).toBe(2);
  });
});

describe("summarizeHistory", () => {
  it("returns an honest empty summary when there is no data", () => {
    const h = summarizeHistory([], []);
    expect(h.yearsTracked).toBe(0);
    expect(h.historicalAverage).toBeNull();
    expect(h.growthSinceEnrolment).toBeNull();
    expect(h.trend).toBe("insufficient_data");
  });

  it("computes growth, extremes, historical average and trend", () => {
    const marks = normaliseMarks([
      mark({ ...Y.y2022, rawScore: 52 }),
      mark({ ...Y.y2023, rawScore: 59 }),
      mark({ ...Y.y2024, rawScore: 67 }),
    ]);
    const h = summarizeHistory(marks, buildYearlySeries(marks));
    expect(h.yearsTracked).toBe(3);
    expect(h.growthSinceEnrolment).toBeCloseTo(15);
    expect(h.highestYear?.yearName).toBe("2024");
    expect(h.lowestYear?.yearName).toBe("2022");
    expect(h.historicalAverage).toBeCloseTo(59.3333, 3);
    expect(h.trend).toBe("improving");
  });

  it("does not call a single year a trend", () => {
    const marks = normaliseMarks([mark({})]);
    const h = summarizeHistory(marks, buildYearlySeries(marks));
    expect(h.growthSinceEnrolment).toBeNull();
    expect(h.trend).toBe("insufficient_data");
  });
});

describe("subject progression and term averages", () => {
  it("tracks each subject separately across years", () => {
    const marks = normaliseMarks([
      mark({ ...Y.y2023, rawScore: 40 }),
      mark({ ...Y.y2024, rawScore: 70 }),
      mark({ ...Y.y2023, subjectId: "eng", subjectName: "English", rawScore: 70 }),
      mark({ ...Y.y2024, subjectId: "eng", subjectName: "English", rawScore: 52 }),
    ]);
    const p = buildSubjectProgression(marks);
    expect(p.find((s) => s.subjectId === "math")?.direction).toBe("improving");
    expect(p.find((s) => s.subjectId === "eng")?.direction).toBe("declining");
  });

  it("averages per term", () => {
    const t = buildTermAverages(normaliseMarks([mark({ termNumber: 1, rawScore: 40 }), mark({ termNumber: 2, rawScore: 80 })]));
    expect(t.map((x) => x.average)).toEqual([40, 80]);
  });
});

describe("summarizeSchool", () => {
  const bands: GradeBand[] = [
    { label: "Excellent", min: 80, max: 100, order: 1 },
    { label: "Good", min: 50, max: 79.99, order: 2 },
    { label: "Needs Improvement", min: 0, max: 49.99, order: 3 },
  ];
  const marks = normaliseMarks([
    // s1: improving 40 -> 80 in Grade 1 Mathematics
    mark({ studentId: "s1", ...Y.y2023, rawScore: 40 }),
    mark({ studentId: "s1", ...Y.y2024, rawScore: 80 }),
    // s2: declining 80 -> 40 in Grade 2 English
    mark({ studentId: "s2", classId: "c2", classLabel: "Grade 2", subjectId: "eng", subjectName: "English", ...Y.y2023, rawScore: 80 }),
    mark({ studentId: "s2", classId: "c2", classLabel: "Grade 2", subjectId: "eng", subjectName: "English", ...Y.y2024, rawScore: 40 }),
    // s3: only one year -> never labelled
    mark({ studentId: "s3", ...Y.y2024, rawScore: 60 }),
  ]);

  it("counts students improving, declining, consistent and unlabelled", () => {
    const s = summarizeSchool(marks, {}, bands);
    expect(s.studentsAssessed).toBe(3);
    expect(s.improving).toBe(1);
    expect(s.declining).toBe(1);
    expect(s.consistent).toBe(0);
    expect(s.insufficientHistory).toBe(1);
  });

  it("identifies best and weakest class and subject", () => {
    const s = summarizeSchool(marks, {}, bands);
    expect(s.bestClass?.label).toBe("Grade 1");
    expect(s.weakestClass?.label).toBe("Grade 2");
    expect(s.bestSubject?.label).toBe("Mathematics");
    expect(s.weakestSubject?.label).toBe("English");
    expect(s.weakestSubject?.needsIntervention).toBe(true); // 30pp decline
  });

  it("respects the year filter for averages but keeps trends across years", () => {
    const s = summarizeSchool(marks, { yearId: "y2024" }, bands);
    expect(s.overallAverage).toBeCloseTo((80 + 40 + 60) / 3);
    expect(s.improving).toBe(1);
  });

  it("filters by class", () => {
    const s = summarizeSchool(marks, { classId: "c2" }, bands);
    expect(s.studentsAssessed).toBe(1);
    expect(s.classAverages).toHaveLength(1);
  });

  it("buckets students into the configured bands, not hardcoded ones", () => {
    const s = summarizeSchool(marks, { yearId: "y2024" }, bands);
    expect(s.distribution).toEqual([
      { label: "Excellent", count: 1 },
      { label: "Good", count: 1 },
      { label: "Needs Improvement", count: 1 },
    ]);
    expect(s.unbanded).toBe(0);
  });

  it("reports students outside every band instead of dropping them silently", () => {
    const s = summarizeSchool(marks, { yearId: "y2024" }, [{ label: "Only", min: 90, max: 100, order: 1 }]);
    expect(s.unbanded).toBe(3);
  });

  it("returns nulls, not zeros, for an empty school", () => {
    const s = summarizeSchool([], {}, bands);
    expect(s.overallAverage).toBeNull();
    expect(s.bestClass).toBeNull();
    expect(s.studentsAssessed).toBe(0);
  });
});

describe("buildEarlyWarnings", () => {
  const termMarks = (studentId: string, scores: number[]) =>
    scores.map((raw, i) => mark({ studentId, ...Y.y2024, termNumber: i + 1, rawScore: raw }));

  it("flags a declining student and one below threshold, with the data that triggered it", () => {
    const rows = buildEarlyWarnings(normaliseMarks(termMarks("a", [80, 70, 55])));
    expect(rows[0].flags).toContain("declining");
    expect(rows[0].change).toBeCloseTo(-25);
  });

  it("flags consistently low, and below threshold", () => {
    const rows = buildEarlyWarnings(normaliseMarks(termMarks("a", [40, 41, 40])));
    expect(rows[0].flags).toEqual(expect.arrayContaining(["consistently_low", "below_threshold", "stagnant"]));
  });

  it("flags significant improvement", () => {
    const rows = buildEarlyWarnings(normaliseMarks(termMarks("a", [50, 60, 72])));
    expect(rows[0].flags).toContain("improving");
  });

  it("never flags a student on incomplete records", () => {
    expect(buildEarlyWarnings(normaliseMarks(termMarks("a", [20, 15])))).toEqual([]);
  });

  it("ignores missing marks rather than treating them as zero", () => {
    const m = normaliseMarks([...termMarks("a", [70, 72, 71]), mark({ studentId: "a", ...Y.y2024, termNumber: 3, rawScore: null })]);
    const rows = buildEarlyWarnings(m);
    expect(rows[0].assessments).toBe(3); // the null mark is not an assessment
    expect(rows[0].flags).not.toContain("below_threshold");
    expect(rows[0].flags).not.toContain("declining");
  });

  it("sorts weakest first", () => {
    const rows = buildEarlyWarnings(normaliseMarks([...termMarks("a", [40, 41, 42]), ...termMarks("b", [30, 31, 32])]));
    expect(rows.map((r) => r.studentId)).toEqual(["b", "a"]);
  });
});

describe("attendancePercentage", () => {
  it("counts late as attended and returns null with no records", () => {
    expect(attendancePercentage(8, 1, 1)).toBe(90);
    expect(attendancePercentage(0, 0, 0)).toBeNull();
  });
});

describe("buildMatrix", () => {
  it("leaves absent class/year cells out instead of zero", () => {
    const m = normaliseMarks([
      mark({ ...Y.y2023, classLabel: "Grade 1", rawScore: 60 }),
      mark({ ...Y.y2024, classLabel: "Grade 1", rawScore: 70 }),
      mark({ ...Y.y2024, classLabel: "Grade 2", rawScore: 50 }),
    ]);
    const rows = buildMatrix(m, (x) => x.classLabel);
    expect(rows[0]).toEqual({ year: "2023", "Grade 1": 60 });
    expect(rows[1]).toEqual({ year: "2024", "Grade 1": 70, "Grade 2": 50 });
  });
});

describe("summarizeSchool students and categories", () => {
  it("attaches each student's configured category", () => {
    const bands: GradeBand[] = [
      { label: "High", min: 60, max: 100, order: 1 },
      { label: "Low", min: 0, max: 59.99, order: 2 },
    ];
    const s = summarizeSchool(normaliseMarks([mark({ studentId: "x", rawScore: 80 }), mark({ studentId: "y", rawScore: 30 })]), {}, bands);
    expect(s.students.find((r) => r.studentId === "x")?.band).toBe("High");
    expect(s.students.find((r) => r.studentId === "y")?.band).toBe("Low");
  });
});

// ---------------------------------------------------------------------- CBC level marks
const LABELS = ["A — Exceeding Expectation", "B — Meeting Expectation", "C — Approaching Expectation", "D — Below Expectation"];
function lvl(order: number, p: Partial<PerfMark> = {}): PerfMark {
  return mark({ kind: "level", rawScore: null, maxScore: null, levelOrder: order, levelCount: 4, levelPoints: null, levelLabel: LABELS[order - 1], ...p });
}

describe("CBC level scoring", () => {
  it("scores the best level highest when the scale has no points (A=4 ... D=1)", () => {
    expect(normaliseMarks([lvl(1), lvl(2), lvl(3), lvl(4)]).map((m) => m.score)).toEqual([4, 3, 2, 1]);
  });

  it("uses the scale's own points when it has them", () => {
    expect(levelPoints(2.5, 2, 4)).toBe(2.5);
    expect(levelPoints(null, 2, 4)).toBe(3);
  });

  it("drops level marks it cannot place on the scale instead of guessing", () => {
    expect(normaliseMarks([lvl(0), lvl(5), lvl(1, { levelCount: null }), lvl(1, { levelOrder: null })])).toEqual([]);
  });

  it("reads improvement from D to A as improving, not declining", () => {
    const m = normaliseMarks([lvl(4, { ...Y.y2023 }), lvl(3, { ...Y.y2023 }), lvl(1, { ...Y.y2024 }), lvl(1, { ...Y.y2024 })]);
    const pts = buildYearlySeries(m);
    const h = summarizeHistory(m, pts, configFor("level", 4));
    expect(h.trend).toBe("improving");
    expect(h.growthSinceEnrolment).toBeCloseTo(4 - 1.5);
  });

  it("uses a quarter of a level as the stable band", () => {
    const m = normaliseMarks([lvl(2, { ...Y.y2023 }), lvl(2, { ...Y.y2024 })]);
    expect(summarizeHistory(m, buildYearlySeries(m), configFor("level", 4)).trend).toBe("stable");
  });

  it("builds one band per level so every student lands in exactly one", () => {
    const marks = normaliseMarks([lvl(1), lvl(2), lvl(3), lvl(4)]);
    const bands = levelBands(marks);
    expect(bands.map((b) => b.label)).toEqual(LABELS);
    const s = summarizeSchool(
      normaliseMarks([lvl(1, { studentId: "a" }), lvl(2, { studentId: "b" }), lvl(3, { studentId: "c" }), lvl(4, { studentId: "d" })]),
      {},
      bands,
      configFor("level", 4),
    );
    expect(s.distribution.map((d) => d.count)).toEqual([1, 1, 1, 1]);
    expect(s.unbanded).toBe(0);
  });

  it("defaults the attention threshold to the scale midpoint", () => {
    expect(configFor("level", 4).threshold).toBe(2.5);
    expect(configFor("percent").threshold).toBe(50);
    expect(configFor("level", 4, 2).threshold).toBe(2);
  });

  it("flags a CBC student sliding from A to C", () => {
    const m = normaliseMarks([lvl(1, { termNumber: 1 }), lvl(2, { termNumber: 2 }), lvl(3, { termNumber: 3 })].map((x) => ({ ...x, ...Y.y2024 })));
    const rows = buildEarlyWarnings(m, configFor("level", 4));
    expect(rows[0].flags).toContain("declining");
    expect(rows[0].flags).toContain("below_threshold");
  });
});

describe("level series need a level-sized stable band", () => {
  it("shows a slide from A to D as declining, which the default 5-point band would hide", async () => {
    const { classifyTrend } = await import("./growth-trend");
    const series = [lvl(1), lvl(2), lvl(4)].map((m) => ({ label: "t", value: levelPoints(null, m.levelOrder as number, 4) })); // 4, 3, 1
    expect(classifyTrend(series).direction).toBe("stable"); // default threshold 5: wrong for a 1-4 scale
    expect(classifyTrend(series, configFor("level", 4).stable).direction).toBe("declining");
  });
});

describe("reproduces the live school's CBC figures", () => {
  // The distribution below is the real set of closed-exam CBC marks in the production database as of
  // 2026-11-05 (counts only, no learner data), and the expected averages were computed independently
  // in SQL: 2026 = 21/6 = 3.5, 2027 = 136/44 = 3.0909.
  const dist: [number, number, number][] = [
    [0, 1, 3], [0, 2, 3], // 2026, term 1: 3 x A, 3 x B
    [1, 1, 21], [1, 2, 10], [1, 3, 9], [1, 4, 4], // 2027, term 3
  ];
  const yr = (y: number) => ({ yearId: `y${2026 + y}`, yearName: String(2026 + y), yearStart: `${2026 + y}-01-01` });
  const marks = normaliseMarks(
    dist.flatMap(([y, level, n]) => Array.from({ length: n }, () => lvl(level, { ...yr(y), termNumber: y === 0 ? 1 : 3, studentId: `s${y}` }))),
  );
  it("matches the SQL year averages and flags both years as incomplete", () => {
    const years = buildYearlySeries(marks);
    expect(years.map((y) => y.yearName)).toEqual(["2026", "2027"]);
    expect(years[0].average).toBeCloseTo(3.5, 4);
    expect(years[1].average).toBeCloseTo(136 / 44, 4);
    expect(years.every((y) => y.incomplete)).toBe(true);
    expect(years[1].changeFromPrevious).toBeCloseTo(136 / 44 - 3.5, 4);
  });

  it("reads the 3.5 -> 3.09 fall as a decline on the level scale", () => {
    const years = buildYearlySeries(marks);
    expect(summarizeHistory(marks, years, configFor("level", 4)).trend).toBe("declining");
  });
});

describe("levelBandsFromScale", () => {
  it("builds the same bands from a scale's levels as from marks on that scale", () => {
    const fromMarks = levelBands(normaliseMarks([lvl(1), lvl(2), lvl(3), lvl(4)]));
    const fromScale = levelBandsFromScale(LABELS.map((label, i) => ({ label, level_order: i + 1, points: null })));
    expect(fromScale).toEqual(fromMarks);
  });
});
