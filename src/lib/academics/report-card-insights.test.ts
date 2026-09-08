import { describe, it, expect } from "vitest";
import { buildReportCardInsights } from "./report-card-insights";

describe("buildReportCardInsights", () => {
  it("returns empty everything for no data", () => {
    const result = buildReportCardInsights({
      achievementBands: [],
      competencyRatings: [],
      improvingSubjects: [],
      decliningSubjects: [],
    });
    expect(result).toEqual({ achievementDistribution: [], strengths: [], areasForSupport: [] });
  });

  it("counts achievement bands and sorts distribution best-band-first", () => {
    const result = buildReportCardInsights({
      achievementBands: [
        { label: "ME1", levelOrder: 6 },
        { label: "EE1", levelOrder: 8 },
        { label: "ME1", levelOrder: 6 },
        { label: "BE2", levelOrder: 1 },
      ],
      competencyRatings: [],
      improvingSubjects: [],
      decliningSubjects: [],
    });
    expect(result.achievementDistribution).toEqual([
      { label: "EE1", levelOrder: 8, count: 1 },
      { label: "ME1", levelOrder: 6, count: 2 },
      { label: "BE2", levelOrder: 1, count: 1 },
    ]);
  });

  it("flags a top-band competency rating as a strength", () => {
    const result = buildReportCardInsights({
      achievementBands: [],
      competencyRatings: [{ name: "Critical Thinking", label: "Consistently Demonstrates", levelOrder: 3, maxLevelOrder: 3 }],
      improvingSubjects: [],
      decliningSubjects: [],
    });
    expect(result.strengths).toEqual(["Critical Thinking (Consistently Demonstrates)"]);
    expect(result.areasForSupport).toEqual([]);
  });

  it("flags a bottom-band (levelOrder 1) competency rating as an area for support", () => {
    const result = buildReportCardInsights({
      achievementBands: [],
      competencyRatings: [{ name: "Communication", label: "Needs Support", levelOrder: 1, maxLevelOrder: 3 }],
      improvingSubjects: [],
      decliningSubjects: [],
    });
    expect(result.areasForSupport).toEqual(["Communication (Needs Support)"]);
    expect(result.strengths).toEqual([]);
  });

  it("does not flag a mid-band rating as either strength or support", () => {
    const result = buildReportCardInsights({
      achievementBands: [],
      competencyRatings: [{ name: "Digital Literacy", label: "Developing", levelOrder: 2, maxLevelOrder: 3 }],
      improvingSubjects: [],
      decliningSubjects: [],
    });
    expect(result.strengths).toEqual([]);
    expect(result.areasForSupport).toEqual([]);
  });

  it("respects a scale's own maxLevelOrder rather than assuming 3 or 8", () => {
    const result = buildReportCardInsights({
      achievementBands: [],
      competencyRatings: [{ name: "Mathematics mastery", label: "EE1", levelOrder: 8, maxLevelOrder: 8 }],
      improvingSubjects: [],
      decliningSubjects: [],
    });
    expect(result.strengths).toEqual(["Mathematics mastery (EE1)"]);
  });

  it("includes improving/declining subjects, each sorted alphabetically", () => {
    const result = buildReportCardInsights({
      achievementBands: [],
      competencyRatings: [],
      improvingSubjects: ["Mathematics", "English"],
      decliningSubjects: ["Kiswahili", "Chemistry"],
    });
    expect(result.strengths).toEqual(["English -- improving", "Mathematics -- improving"]);
    expect(result.areasForSupport).toEqual(["Chemistry -- declining", "Kiswahili -- declining"]);
  });

  it("combines competency and subject-trend signals in one report", () => {
    const result = buildReportCardInsights({
      achievementBands: [{ label: "ME1", levelOrder: 6 }],
      competencyRatings: [
        { name: "Creativity", label: "Consistently Demonstrates", levelOrder: 3, maxLevelOrder: 3 },
        { name: "Self-Efficacy", label: "Needs Support", levelOrder: 1, maxLevelOrder: 3 },
      ],
      improvingSubjects: ["Mathematics"],
      decliningSubjects: ["Chemistry"],
    });
    expect(result.strengths).toEqual(["Creativity (Consistently Demonstrates)", "Mathematics -- improving"]);
    expect(result.areasForSupport).toEqual(["Self-Efficacy (Needs Support)", "Chemistry -- declining"]);
    expect(result.achievementDistribution).toEqual([{ label: "ME1", levelOrder: 6, count: 1 }]);
  });
});
