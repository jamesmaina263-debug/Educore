import { describe, expect, it } from "vitest";
import { computePathwayFit, scoreMark, type PathwayFitMarkInput } from "./pathway-fit";

function mark(overrides: Partial<PathwayFitMarkInput>): PathwayFitMarkInput {
  return {
    subjectId: "subj-1",
    subjectName: "Mathematics",
    pathway: "STEM",
    isCore: false,
    rawScore: null,
    maxScore: null,
    bandLabel: null,
    ...overrides,
  };
}

describe("scoreMark", () => {
  it("scores a numeric mark as a percentage of max_score", () => {
    expect(scoreMark({ rawScore: 78, maxScore: 100, bandLabel: null })).toBe(78);
    expect(scoreMark({ rawScore: 35, maxScore: 50, bandLabel: null })).toBe(70);
  });

  it("clamps an out-of-range raw score into 0-100", () => {
    expect(scoreMark({ rawScore: 120, maxScore: 100, bandLabel: null })).toBe(100);
  });

  it("scores a CBC band by matching the real KICD/KNEC wording", () => {
    expect(scoreMark({ rawScore: null, maxScore: null, bandLabel: "Exceeding Expectation" })).toBe(100);
    expect(scoreMark({ rawScore: null, maxScore: null, bandLabel: "Meeting Expectation" })).toBe(75);
    expect(scoreMark({ rawScore: null, maxScore: null, bandLabel: "Approaching Expectation" })).toBe(50);
    expect(scoreMark({ rawScore: null, maxScore: null, bandLabel: "Below Expectation" })).toBe(25);
  });

  it("is case-insensitive on band wording", () => {
    expect(scoreMark({ rawScore: null, maxScore: null, bandLabel: "exceeding expectation" })).toBe(100);
  });

  it("does not guess a score for a custom band label it can't recognize", () => {
    expect(scoreMark({ rawScore: null, maxScore: null, bandLabel: "Star Performer" })).toBeNull();
  });

  it("returns null when there is nothing to score", () => {
    expect(scoreMark({ rawScore: null, maxScore: null, bandLabel: null })).toBeNull();
    expect(scoreMark({ rawScore: 50, maxScore: 0, bandLabel: null })).toBeNull();
  });
});

describe("computePathwayFit", () => {
  it("is ineligible with zero pathway-mapped subjects", () => {
    const result = computePathwayFit([mark({ isCore: true, pathway: "Core", rawScore: 90, maxScore: 100 })]);
    expect(result.eligible).toBe(false);
    expect(result.pathways).toEqual([]);
  });

  it("is ineligible with only one scored pathway subject", () => {
    const result = computePathwayFit([mark({ rawScore: 90, maxScore: 100 })]);
    expect(result.eligible).toBe(false);
    expect(result.ineligibleReason).toMatch(/only one/i);
  });

  it("ignores Core subjects entirely, even with strong scores", () => {
    const result = computePathwayFit([
      mark({ subjectId: "eng", subjectName: "English", pathway: "Core", isCore: true, rawScore: 99, maxScore: 100 }),
      mark({ subjectId: "math", subjectName: "Mathematics", pathway: "STEM", rawScore: 80, maxScore: 100 }),
      mark({ subjectId: "bio", subjectName: "Biology", pathway: "STEM", rawScore: 70, maxScore: 100 }),
    ]);
    expect(result.eligible).toBe(true);
    expect(result.pathways).toHaveLength(1);
    expect(result.pathways[0].pathway).toBe("STEM");
  });

  it("averages repeated marks for the same subject across exams", () => {
    const result = computePathwayFit([
      mark({ subjectId: "math", subjectName: "Mathematics", pathway: "STEM", rawScore: 80, maxScore: 100 }),
      mark({ subjectId: "math", subjectName: "Mathematics", pathway: "STEM", rawScore: 60, maxScore: 100 }),
      mark({ subjectId: "geo", subjectName: "Geography", pathway: "Social Sciences", rawScore: 50, maxScore: 100 }),
    ]);
    const stem = result.pathways.find((p) => p.pathway === "STEM");
    expect(stem?.subjects[0].percent).toBe(70);
    expect(stem?.subjects[0].markCount).toBe(2);
  });

  it("ranks pathways best-first by equal-weighted subject average", () => {
    const result = computePathwayFit([
      mark({ subjectId: "math", subjectName: "Mathematics", pathway: "STEM", rawScore: 60, maxScore: 100 }),
      mark({ subjectId: "bio", subjectName: "Biology", pathway: "STEM", rawScore: 50, maxScore: 100 }),
      mark({ subjectId: "geo", subjectName: "Geography", pathway: "Social Sciences", rawScore: 90, maxScore: 100 }),
      mark({ subjectId: "hist", subjectName: "History and Citizenship", pathway: "Social Sciences", rawScore: 85, maxScore: 100 }),
    ]);
    expect(result.pathways.map((p) => p.pathway)).toEqual(["Social Sciences", "STEM"]);
    expect(result.pathways[0].averagePercent).toBe(87.5);
    expect(result.pathways[1].averagePercent).toBe(55);
  });

  it("skips marks with an unmapped or unrecognized pathway rather than guessing", () => {
    const result = computePathwayFit([
      mark({ subjectId: "math", subjectName: "Mathematics", pathway: "STEM", rawScore: 80, maxScore: 100 }),
      mark({ subjectId: "x", subjectName: "Unmapped Subject", pathway: null, rawScore: 99, maxScore: 100 }),
      mark({ subjectId: "y", subjectName: "Weird Subject", pathway: "Not A Real Pathway", rawScore: 99, maxScore: 100 }),
      mark({ subjectId: "geo", subjectName: "Geography", pathway: "Social Sciences", rawScore: 40, maxScore: 100 }),
    ]);
    expect(result.eligible).toBe(true);
    const subjectNames = result.pathways.flatMap((p) => p.subjects.map((s) => s.subjectName));
    expect(subjectNames).not.toContain("Unmapped Subject");
    expect(subjectNames).not.toContain("Weird Subject");
  });

  it("skips unscoreable marks (unrecognized CBC band, no raw score) without crashing", () => {
    const result = computePathwayFit([
      mark({ subjectId: "math", subjectName: "Mathematics", pathway: "STEM", rawScore: 80, maxScore: 100 }),
      mark({ subjectId: "phy", subjectName: "Physics", pathway: "STEM", bandLabel: "Custom Label" }),
      mark({ subjectId: "geo", subjectName: "Geography", pathway: "Social Sciences", rawScore: 40, maxScore: 100 }),
    ]);
    const stem = result.pathways.find((p) => p.pathway === "STEM");
    expect(stem?.subjects).toHaveLength(1);
    expect(stem?.subjects[0].subjectName).toBe("Mathematics");
  });
});
