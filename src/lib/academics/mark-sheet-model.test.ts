import { describe, it, expect } from "vitest";
import { buildMarkSheetModel, markSheetExportRows, splitBandLabel, type RawMarkSheetInput } from "./mark-sheet-model";

const school = { name: "Gititu High", motto: null, logoUrl: null, address: null, phone: null, email: null, primaryColor: null };
const subjects = [
  { id: "m", name: "Mathematics", maxScore: 100 },
  { id: "e", name: "English", maxScore: 100 },
];
const stu = (id: string, first: string, stream = "A") => ({ id, admissionNumber: `ADM${id}`, firstName: first, lastName: "Doe", otherNames: null, streamName: stream });
const base = (over: Partial<RawMarkSheetInput> = {}): RawMarkSheetInput => ({
  school,
  exam: { name: "CAT 1", examType: "cat", status: "closed", termName: "Term 2", academicYearName: "2026" },
  classLabel: "Grade 6",
  subjects,
  students: [stu("1", "Ann"), stu("2", "Ben"), stu("3", "Cy")],
  marks: [],
  rankings: [],
  generatedAt: "2026-10-18T08:00:00Z",
  preparedBy: "Ms Wanjiku",
  ...over,
});
const num = (studentId: string, subjectId: string, rawScore: number | null, bandLabel: string | null = null) => ({ studentId, subjectId, rawScore, bandLabel, bandLevel: 1 });

describe("numeric exam", () => {
  const input = base({
    marks: [num("1", "m", 80, "A — Excellent"), num("1", "e", 60, "B — Good"), num("2", "m", 0, "E — Poor"), num("2", "e", 50, "C — Fair")],
    rankings: [
      { studentId: "1", totalScore: 140, averageScore: 70, rankInStream: 1, rankInClass: 1 },
      { studentId: "2", totalScore: 50, averageScore: 25, rankInStream: 2, rankInClass: 2 },
    ],
  });
  const model = buildMarkSheetModel(input);

  it("totals come from entered scores and cells show score plus grade code", () => {
    expect(model.kind).toBe("numeric");
    expect(model.learners[0].total).toBe(140);
    expect(model.learners[0].cells.m.text).toBe("80 A");
  });
  it("a genuine zero is a score, not a missing result", () => {
    const ben = model.learners[1];
    expect(ben.cells.m).toEqual({ text: "0 E", score: 0, missing: false });
    expect(ben.total).toBe(50);
  });
  it("a missing mark prints an em dash, is excluded from stats and flags the learner incomplete", () => {
    const cy = model.learners[2];
    expect(cy.cells.m).toEqual({ text: "—", score: null, missing: true });
    expect(cy.incomplete).toBe(true);
    expect(cy.total).toBeNull();
    expect(model.subjectStats.m).toMatchObject({ entered: 2, missing: 1, mean: 40, highest: 80, lowest: 0 });
    expect(model.incompleteCount).toBe(1);
  });
  it("uses the stored average and positions and reports the class mean", () => {
    expect(model.showRanking).toBe(true);
    expect(model.learners[0]).toMatchObject({ average: 70, rankInStream: 1 });
    expect(model.classMean).toBe(47.5);
  });
  it("builds a grade legend from the labels in use", () => {
    expect(model.legend).toContainEqual({ code: "A", meaning: "Excellent" });
  });
  it("keeps Excel/CSV rows in step with the model, a real zero staying numeric", () => {
    const rows = markSheetExportRows(model);
    expect(rows[1]).toMatchObject({ "Adm No": "ADM2", Mathematics: 0, Total: 50, "Average %": 25, Position: 2 });
    expect(rows[2].Mathematics).toBe("—");
  });
});

describe("competency-based (CBC) exam", () => {
  const model = buildMarkSheetModel(
    base({
      marks: [
        { studentId: "1", subjectId: "m", rawScore: null, bandLabel: "EE — Exceeding Expectation", bandLevel: 4 },
        { studentId: "2", subjectId: "m", rawScore: null, bandLabel: "ME — Meeting Expectation", bandLevel: 3 },
        { studentId: "3", subjectId: "m", rawScore: null, bandLabel: "EE — Exceeding Expectation", bandLevel: 4 },
      ],
    }),
  );
  it("shows descriptors, never averages or positions, and does not invent a total", () => {
    expect(model.kind).toBe("cbc");
    expect(model.showRanking).toBe(false);
    expect(model.classMean).toBeNull();
    expect(model.learners[0]).toMatchObject({ total: null, average: null, rankInStream: null });
    expect(model.learners[0].cells.m.text).toBe("EE");
  });
  it("summarises the class as a best-first band distribution", () => {
    expect(model.subjectStats.m.distribution).toEqual([
      { code: "EE", count: 2 },
      { code: "ME", count: 1 },
    ]);
    expect(model.subjectStats.m.mean).toBeNull();
    expect(model.legend).toEqual([
      { code: "EE", meaning: "Exceeding Expectation" },
      { code: "ME", meaning: "Meeting Expectation" },
    ]);
  });
  it("exports no Average/Position columns", () => {
    expect(Object.keys(markSheetExportRows(model)[0])).toEqual(["Adm No", "Student", "Mathematics", "English"]);
  });
});

describe("other cases", () => {
  it("an exam still open is provisional and has no positions", () => {
    const model = buildMarkSheetModel(base({ exam: { ...base().exam, status: "open" }, marks: [num("1", "m", 50)] }));
    expect(model.provisional).toBe(true);
    expect(model.showRanking).toBe(false);
  });
  it("an exam with no marks at all is empty, not a table of zeros", () => {
    const model = buildMarkSheetModel(base());
    expect(model.kind).toBe("empty");
    expect(model.learners.every((l) => l.cells.m.missing)).toBe(true);
  });
  it("flags multiple streams so the sheet can show a stream column", () => {
    expect(buildMarkSheetModel(base({ students: [stu("1", "A", "East"), stu("2", "B", "West")] })).multiStream).toBe(true);
    expect(buildMarkSheetModel(base()).multiStream).toBe(false);
  });
  it("mixed numeric and band-only marks suppress ranking (incompatible scales are not combined)", () => {
    const model = buildMarkSheetModel(
      base({
        marks: [num("1", "m", 80), { studentId: "1", subjectId: "e", rawScore: null, bandLabel: "ME — Meeting", bandLevel: 3 }],
        rankings: [{ studentId: "1", totalScore: 80, averageScore: 80, rankInStream: 1, rankInClass: 1 }],
      }),
    );
    expect(model.kind).toBe("mixed");
    expect(model.showRanking).toBe(false);
  });
  it("splitBandLabel handles labels with and without a descriptor", () => {
    expect(splitBandLabel("A — Exceeding Expectation")).toEqual({ code: "A", meaning: "Exceeding Expectation" });
    expect(splitBandLabel("Distinction")).toEqual({ code: "Distinction", meaning: null });
  });
});

describe("selective subjects (per-student enrolment)", () => {
  const row = (studentId: string, subjectId: string, isActive = true) => ({ studentId, subjectId, isActive });
  const realistic = () =>
    base({
      marks: [num("1", "m", 80, "A — Excellent"), num("1", "e", 60, "B — Good"), num("2", "m", 50, "C — Fair"), num("3", "m", 40)],
      rankings: [{ studentId: "1", totalScore: 140, averageScore: 70, rankInStream: 1, rankInClass: 1 }],
    });

  it("with no enrolment rows the sheet is identical to one built without the option (nothing changes for existing schools)", () => {
    expect(buildMarkSheetModel({ ...realistic(), enrolmentRows: [] })).toEqual(buildMarkSheetModel(realistic()));
    const model = buildMarkSheetModel(realistic());
    expect(model.learners.flatMap((l) => Object.values(l.cells)).some((c) => "notApplicable" in c)).toBe(false);
  });

  it("a learner who does not take a selective subject gets n/a: not missing, not expected, not incomplete", () => {
    // English is selective: only Ann takes it. Ben and Cy do not, and have no English marks.
    const model = buildMarkSheetModel({ ...realistic(), enrolmentRows: [row("1", "e", true), row("2", "e", false)] });
    const [ann, ben, cy] = model.learners;
    expect(ben.cells.e).toEqual({ text: "n/a", score: null, missing: false, notApplicable: true });
    expect(cy.cells.e).toEqual({ text: "n/a", score: null, missing: false, notApplicable: true });
    expect(ann.cells.e).toMatchObject({ score: 60, missing: false });
    expect(ann).toMatchObject({ expected: 2, entered: 2, incomplete: false });
    expect(ben).toMatchObject({ expected: 1, entered: 1, incomplete: false });
    expect(cy).toMatchObject({ expected: 1, entered: 1, incomplete: false });
    expect(model.incompleteCount).toBe(0);
    // The universal subject is untouched, and English's stats only count the learner who takes it.
    expect(model.subjectStats.m).toMatchObject({ entered: 3, missing: 0 });
    expect(model.subjectStats.e).toMatchObject({ entered: 1, missing: 0, mean: 60 });
  });

  it("a learner who takes a selective subject but has no mark is still flagged as missing it", () => {
    const model = buildMarkSheetModel({
      ...base({ marks: [num("1", "m", 80), num("2", "m", 50), num("3", "m", 40), num("1", "e", 60)] }),
      enrolmentRows: [row("1", "e", true), row("2", "e", true)], // Ben takes English but has no mark
    });
    const [, ben, cy] = model.learners;
    expect(ben.cells.e).toEqual({ text: "—", score: null, missing: true });
    expect(ben).toMatchObject({ expected: 2, entered: 1, incomplete: true });
    expect(cy.cells.e.notApplicable).toBe(true);
    expect(model.subjectStats.e).toMatchObject({ entered: 1, missing: 1 });
    expect(model.incompleteCount).toBe(1);
  });

  it("an existing mark keeps a learner in the subject even if staff later un-enrolled them (history is protected)", () => {
    const model = buildMarkSheetModel({
      ...base({ marks: [num("1", "m", 80), num("2", "m", 50), num("3", "m", 40), num("2", "e", 55)] }),
      enrolmentRows: [row("1", "e", true), row("2", "e", false)],
    });
    expect(model.learners[1].cells.e).toMatchObject({ score: 55, missing: false });
    expect(model.learners[1].cells.e.notApplicable).toBeUndefined();
  });

  it("n/a is never counted as zero in totals or statistics", () => {
    const model = buildMarkSheetModel({ ...realistic(), enrolmentRows: [row("1", "e", true)] });
    expect(model.learners[1].total).toBe(50);
    expect(model.subjectStats.e.lowest).toBe(60);
  });

  it("Excel/CSV rows show n/a for a subject the learner does not take", () => {
    const rows = markSheetExportRows(buildMarkSheetModel({ ...realistic(), enrolmentRows: [row("1", "e", true)] }));
    expect(rows[1].English).toBe("n/a");
    expect(rows[0].English).toBe(60);
  });
});
