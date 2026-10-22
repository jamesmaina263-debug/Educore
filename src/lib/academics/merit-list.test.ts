import { describe, it, expect } from "vitest";
import { buildMarkSheetModel, type RawMarkSheetInput } from "./mark-sheet-model";
import { buildMeritList, meritExportRows, meritListEligibility } from "./merit-list";

const school = { name: "Gititu High", motto: null, logoUrl: null, address: null, phone: null, email: null, primaryColor: null };
const subjects = [
  { id: "m", name: "Mathematics", maxScore: 100 },
  { id: "p", name: "Practical", maxScore: 50 },
];
const stu = (id: string, first: string, stream = "A") => ({ id, admissionNumber: `A${id}`, firstName: first, lastName: "Doe", otherNames: null, streamName: stream });
const mk = (studentId: string, subjectId: string, rawScore: number | null, bandLabel: string | null = null) => ({ studentId, subjectId, rawScore, bandLabel, bandLevel: 1 });
const input = (over: Partial<RawMarkSheetInput> = {}): RawMarkSheetInput => ({
  school,
  exam: { name: "CAT 1", examType: "cat", status: "closed", termName: "Term 2", academicYearName: "2026" },
  classLabel: "Grade 6",
  subjects,
  students: [stu("1", "Ann"), stu("2", "Ben"), stu("3", "Cy"), stu("4", "Di")],
  marks: [mk("1", "m", 60), mk("1", "p", 50), mk("2", "m", 90), mk("2", "p", 20), mk("3", "m", 70), mk("3", "p", 45)],
  rankings: [
    { studentId: "1", totalScore: 110, averageScore: 80, rankInStream: 1, rankInClass: 1 },
    { studentId: "3", totalScore: 115, averageScore: 80, rankInStream: 1, rankInClass: 1 },
    { studentId: "2", totalScore: 110, averageScore: 65, rankInStream: 3, rankInClass: 3 },
  ],
  generatedAt: "2026-10-19T08:00:00Z",
  preparedBy: "Ms W",
  ...over,
});

describe("meritListEligibility", () => {
  it("only marks-based assessments are eligible; others get a reason instead of invented ranks", () => {
    expect(meritListEligibility(buildMarkSheetModel(input()))).toEqual({ available: true });
    const cbc = buildMarkSheetModel(input({ marks: [mk("1", "m", null, "EE — Exceeding")], rankings: [] }));
    expect(meritListEligibility(cbc)).toMatchObject({ available: false, reason: expect.stringMatching(/competency-based/) });
    expect(meritListEligibility(buildMarkSheetModel(input({ marks: [], rankings: [] })))).toMatchObject({ available: false, reason: expect.stringMatching(/No marks/) });
    const mixed = buildMarkSheetModel(input({ marks: [mk("1", "m", 50), mk("1", "p", null, "ME — Meeting")], rankings: [] }));
    expect(meritListEligibility(mixed)).toMatchObject({ available: false, reason: expect.stringMatching(/mixes/) });
  });
});

describe("buildMeritList", () => {
  const list = buildMeritList(buildMarkSheetModel(input()));
  it("orders by stored class position, ties sharing a position (1, 1, 3), no-result learners last and unranked", () => {
    expect(list.title).toBe("MERIT LIST");
    expect(list.rows.map((r) => [r.learner.name, r.position])).toEqual([
      ["Ann Doe", 1],
      ["Cy Doe", 1],
      ["Ben Doe", 3],
      ["Di Doe", null],
    ]);
    expect(list.tiesPresent).toBe(true);
    expect(list.noResultCount).toBe(1);
    expect(list.incompleteCount).toBe(0); // all ranked learners are complete; the no-result learner is not also counted as incomplete
    expect(list.rows[3].hasResult).toBe(false);
  });
  it("positions are the stored ones, not recomputed (the sheet and the list cannot disagree)", () => {
    const model = buildMarkSheetModel(input());
    const byName = new Map(buildMeritList(model).rows.map((r) => [r.learner.name, r.position]));
    for (const l of model.learners) if (l.average !== null) expect(byName.get(l.name)).toBe(l.rankInClass);
  });
  it("keeps subject performance separate: highest/lowest with who achieved them, and the mean as a percentage of the maximum", () => {
    const practical = list.subjectSummary.find((s) => s.name === "Practical")!;
    expect(practical).toMatchObject({ entered: 3, mean: 38.3, meanPercent: 76.7, highest: 50, lowest: 20 });
    expect(practical.highestBy).toEqual(["Ann Doe"]);
    expect(practical.lowestBy).toEqual(["Ben Doe"]);
    expect(list.subjectSummary.find((s) => s.name === "Mathematics")).toMatchObject({ highest: 90, highestBy: ["Ben Doe"] });
  });
  it("a learner with a missing subject is flagged incomplete but still ranked on entered subjects", () => {
    const model = buildMarkSheetModel(input({ marks: [mk("1", "m", 60), mk("1", "p", 50), mk("2", "m", 90)], rankings: [{ studentId: "1", totalScore: 110, averageScore: 80, rankInStream: 1, rankInClass: 1 }, { studentId: "2", totalScore: 90, averageScore: 90, rankInStream: 1, rankInClass: 1 }] }));
    const row = buildMeritList(model).rows.find((r) => r.learner.name === "Ben Doe")!;
    expect(row.learner.incomplete).toBe(true);
    expect(row.position).toBe(1);
    expect(buildMeritList(model).incompleteCount).toBe(1);
  });
  it("a genuine zero is ranked, not treated as missing", () => {
    const model = buildMarkSheetModel(input({ marks: [mk("1", "m", 0), mk("1", "p", 0)], rankings: [{ studentId: "1", totalScore: 0, averageScore: 0, rankInStream: 1, rankInClass: 1 }] }));
    const row = buildMeritList(model).rows[0];
    expect(row).toMatchObject({ hasResult: true, position: 1 });
    expect(row.learner.cells.m.score).toBe(0);
  });
  it("ranking switched off: titled Examination Results, no positions, original order kept", () => {
    const model = buildMarkSheetModel(input(), { rankingEnabled: false, showSignatures: true, showClassStatistics: true });
    const off = buildMeritList(model);
    expect(off).toMatchObject({ title: "EXAMINATION RESULTS", positioned: false, tiesPresent: false });
    expect(off.rows.map((r) => r.learner.name)).toEqual(["Ann Doe", "Ben Doe", "Cy Doe", "Di Doe"]);
    expect(off.rows.every((r) => r.position === null)).toBe(true);
  });
  it("shows stream positions only when the class has several streams", () => {
    const model = buildMarkSheetModel(input({ students: [stu("1", "Ann", "East"), stu("2", "Ben", "West"), stu("3", "Cy", "East"), stu("4", "Di", "West")] }));
    expect(buildMeritList(model).rows[0].streamPosition).toBe(1);
    expect(buildMeritList(buildMarkSheetModel(input())).rows[0].streamPosition).toBeNull();
  });
});

describe("meritExportRows", () => {
  it("exports the same ordering with a completeness flag, and no Position column when ranking is off", () => {
    const model = buildMarkSheetModel(input());
    const rows = meritExportRows(model, buildMeritList(model));
    expect(rows[0]).toMatchObject({ Position: 1, "Adm No": "A1", Learner: "Ann Doe", Mathematics: 60, Practical: 50, "Average %": 80, "Results complete": "Yes" });
    expect(rows[3]).toMatchObject({ Position: "—", "Results complete": "No result", "Average %": "—" });
    const offModel = buildMarkSheetModel(input(), { rankingEnabled: false, showSignatures: true, showClassStatistics: true });
    expect(meritExportRows(offModel, buildMeritList(offModel))[0]).not.toHaveProperty("Position");
  });
});
