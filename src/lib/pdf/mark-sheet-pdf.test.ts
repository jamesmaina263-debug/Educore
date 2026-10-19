import { describe, it, expect } from "vitest";
import { mkdirSync, writeFileSync } from "node:fs";
import { extractText, getDocumentProxy } from "unpdf";
import { buildMarkSheetPdf } from "./mark-sheet-pdf";
import { buildMarkSheetModel, type RawMarkSheetInput } from "@/lib/academics/mark-sheet-model";

// A valid 16x16 gold PNG, enough to prove the logo embeds without a network or canvas.
const PNG_2X2 =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAABAAAAAQCAIAAACQkWg2AAAAFklEQVR4nGM41cVCEmIY1TCqYfhqAACn8VgQgBpfHAAAAABJRU5ErkJggg==";

const school = { name: "Gititu High School", motto: "Excellence in Service", logoUrl: null, address: "P.O. Box 12, Gititu", phone: "0700 000 000", email: "info@gititu.ac.ke", primaryColor: "#1e293b" };
const subj = (n: number) => Array.from({ length: n }, (_, i) => ({ id: `s${i}`, name: ["Mathematics", "English", "Kiswahili", "Science", "Social Studies", "CRE", "Agriculture", "Music"][i] ?? `Subject ${i}`, maxScore: 100 }));
const students = (n: number, streams = ["A"]) =>
  Array.from({ length: n }, (_, i) => ({ id: `st${i}`, admissionNumber: `A${1000 + i}`, firstName: `First${i}`, lastName: `Last${String(i).padStart(3, "0")}`, otherNames: null, streamName: streams[i % streams.length] }));

function numericInput(n: number, subjectCount: number, streams = ["A"]): RawMarkSheetInput {
  const ss = subj(subjectCount);
  const st = students(n, streams);
  const marks = st.flatMap((s, i) => ss.map((sub, j) => ({ studentId: s.id, subjectId: sub.id, rawScore: (i * 7 + j * 13) % 101, bandLabel: null, bandLevel: null })));
  const rankings = st.map((s, i) => ({ studentId: s.id, totalScore: 0, averageScore: 100 - i * 0.3, rankInStream: i + 1, rankInClass: i + 1 }));
  return { school, exam: { name: "CAT 1", examType: "cat", status: "closed", termName: "Term 2", academicYearName: "2026" }, classLabel: "Grade 6", subjects: ss, students: st, marks, rankings, generatedAt: "2026-10-18T08:00:00Z", preparedBy: "Ms Wanjiku" };
}

async function textOf(doc: Awaited<ReturnType<typeof buildMarkSheetPdf>>) {
  const pdf = await getDocumentProxy(new Uint8Array(doc.output("arraybuffer")));
  const { text, totalPages } = await extractText(pdf, { mergePages: true });
  return { text: Array.isArray(text) ? text.join("\n") : text, totalPages };
}

const OUT = "/tmp/mark-sheet-samples";
function save(name: string, doc: Awaited<ReturnType<typeof buildMarkSheetPdf>>) {
  mkdirSync(OUT, { recursive: true });
  writeFileSync(`${OUT}/${name}.pdf`, Buffer.from(doc.output("arraybuffer")));
}

describe("buildMarkSheetPdf", () => {
  it("produces selectable text: school header, assessment details, learners, marks and statistics", async () => {
    const doc = await buildMarkSheetPdf(buildMarkSheetModel(numericInput(12, 4)), { dataUrl: PNG_2X2, width: 16, height: 16 });
    save("numeric-portrait", doc);
    const { text } = await textOf(doc);
    expect(Buffer.from(doc.output("arraybuffer")).toString("latin1")).toContain("/Subtype /Image"); // logo embedded
    for (const expected of ["Gititu High School", "Excellence in Service", "CLASS MARK SHEET", "CAT 1", "Term 2, 2026", "First0 Last000", "A1000", "Class mean", "Highest", "Lowest", "Prepared by", "Page 1 of"]) {
      expect(text).toContain(expected);
    }
  });

  it("does not repeat the exam type when the name already says it", async () => {
    const { text } = await textOf(await buildMarkSheetPdf(buildMarkSheetModel(numericInput(3, 3)), null));
    expect(text).toContain("CAT 1");
    expect(text).not.toContain("CAT 1 (CAT)");
  });

  it("keeps a short portrait sheet (table, key and both signature blocks) on a single page", async () => {
    const { totalPages } = await textOf(await buildMarkSheetPdf(buildMarkSheetModel(numericInput(12, 2)), null));
    expect(totalPages).toBe(1);
  });

  it("goes landscape for wide sheets and portrait for narrow ones", async () => {
    const wide = await buildMarkSheetPdf(buildMarkSheetModel(numericInput(5, 8)), null);
    const narrow = await buildMarkSheetPdf(buildMarkSheetModel(numericInput(5, 2)), null);
    save("numeric-landscape", wide);
    expect(wide.internal.pageSize.getWidth()).toBeGreaterThan(wide.internal.pageSize.getHeight());
    expect(narrow.internal.pageSize.getWidth()).toBeLessThan(narrow.internal.pageSize.getHeight());
  });

  it("paginates a long class: every learner present, header repeats, page numbers on each page", async () => {
    const doc = await buildMarkSheetPdf(buildMarkSheetModel(numericInput(120, 5, ["East", "West"])), null);
    save("numeric-long-two-streams", doc);
    const { text, totalPages } = await textOf(doc);
    expect(totalPages).toBeGreaterThan(2);
    for (let i = 0; i < 120; i += 1) expect(text).toContain(`Last${String(i).padStart(3, "0")}`);
    for (let p = 1; p <= totalPages; p += 1) expect(text).toContain(`Page ${p} of ${totalPages}`);
    // The table header repeats on every page that carries table rows (the last page may hold only the key and signatures).
    expect((text.match(/Adm No/g) ?? []).length).toBeGreaterThanOrEqual(totalPages - 1);
    expect(text).toContain("Pos");
  });

  it("competency-based sheet shows descriptors and a key, with no average/position columns", async () => {
    const ss = subj(3);
    const st = students(6);
    const labels = ["EE — Exceeding Expectation", "ME — Meeting Expectation", "AE — Approaching Expectation"];
    const marks = st.flatMap((s, i) => ss.map((sub, j) => ({ studentId: s.id, subjectId: sub.id, rawScore: null, bandLabel: labels[(i + j) % 3], bandLevel: 4 - ((i + j) % 3) })));
    const doc = await buildMarkSheetPdf(buildMarkSheetModel({ ...numericInput(6, 3), subjects: ss, students: st, marks, rankings: [] }), null);
    save("cbc", doc);
    const { text } = await textOf(doc);
    expect(text).toContain("Competency-based");
    expect(text).toContain("EE = Exceeding Expectation");
    expect(text).toContain("Performance levels");
    expect(text).not.toContain("Class mean");
    expect(text).not.toMatch(/\bAvg\b/);
  });

  it("marks missing results with a dash, flags incomplete learners and explains the rule", async () => {
    const input = numericInput(4, 3);
    input.marks = input.marks.filter((m) => !(m.studentId === "st1" && m.subjectId === "s0")); // Last001 has no Maths
    input.marks = input.marks.map((m) => (m.studentId === "st2" && m.subjectId === "s0" ? { ...m, rawScore: 0 } : m)); // genuine zero
    const doc = await buildMarkSheetPdf(buildMarkSheetModel(input), null);
    save("missing-and-zero", doc);
    const { text } = await textOf(doc);
    expect(text).toContain("Last001 *");
    expect(text).toContain("never counted as zero");
    expect(text).toContain("results incomplete");
  });

  it("explains n/a for a selective subject and counts marks entered against the learners who take it", async () => {
    const input = numericInput(4, 3);
    // Kiswahili (s2) is selective and only First0 takes it; the others have no mark in it.
    input.marks = input.marks.filter((m) => !(m.subjectId === "s2" && m.studentId !== "st0"));
    input.enrolmentRows = [{ studentId: "st0", subjectId: "s2", isActive: true }];
    const doc = await buildMarkSheetPdf(buildMarkSheetModel(input), null);
    save("selective-subject", doc);
    const { text } = await textOf(doc);
    expect(text).toContain("n/a");
    expect(text).toContain("does not take this subject");
    expect(text).toContain("1/1"); // Kiswahili: 1 mark entered of the 1 learner who takes it
    expect(text).toContain("4/4"); // Mathematics is universal
    expect(text).not.toContain("Last001 *"); // not taking Kiswahili does not make a learner incomplete
  });

  it("a sheet with no selective subjects has no n/a note", async () => {
    const { text } = await textOf(await buildMarkSheetPdf(buildMarkSheetModel(numericInput(4, 3)), null));
    expect(text).not.toContain("does not take this subject");
  });

  it("an open exam is labelled provisional", async () => {
    const input = numericInput(3, 3);
    input.exam = { ...input.exam, status: "open" };
    input.rankings = [];
    const { text } = await textOf(await buildMarkSheetPdf(buildMarkSheetModel(input), null));
    expect(text).toContain("PROVISIONAL");
  });

  it("an exam with no marks yet still renders cleanly", async () => {
    const input = { ...numericInput(3, 3), marks: [], rankings: [] };
    const { text } = await textOf(await buildMarkSheetPdf(buildMarkSheetModel(input), null));
    expect(text).toContain("No marks entered yet");
  });
});
