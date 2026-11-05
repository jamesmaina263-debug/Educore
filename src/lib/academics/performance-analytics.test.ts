import { describe, expect, it } from "vitest";
import {
  buildSubjectProgression,
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
    rawScore: 50,
    maxScore: 100,
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
    expect(a.percentage).toBe(80);
    expect(b.percentage).toBe(40);
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
    expect(out[0].percentage).toBe(0); // a recorded zero is a real zero
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
