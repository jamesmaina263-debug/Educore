import { describe, it, expect } from "vitest";
import { mkdirSync, writeFileSync } from "node:fs";
import { extractText, getDocumentProxy } from "unpdf";
import { buildMeritListPdf } from "./merit-list-pdf";
import { buildMarkSheetModel, type MarkSheetOptions, type RawMarkSheetInput } from "@/lib/academics/mark-sheet-model";
import { buildMeritList } from "@/lib/academics/merit-list";

const school = { name: "Gititu High School", motto: "Excellence in Service", logoUrl: null, address: "P.O. Box 12, Gititu", phone: "0700 000 000", email: "info@gititu.ac.ke", primaryColor: "#1e293b" };
const SUBJECTS = ["Mathematics", "English", "Kiswahili", "Science", "Social Studies", "CRE"];
const subj = (n: number) => SUBJECTS.slice(0, n).map((name, i) => ({ id: `s${i}`, name, maxScore: i === 1 ? 50 : 100 }));
const students = (n: number, streams = ["A"]) =>
  Array.from({ length: n }, (_, i) => ({ id: `st${i}`, admissionNumber: `A${1000 + i}`, firstName: `First${i}`, lastName: `Last${String(i).padStart(3, "0")}`, otherNames: null, streamName: streams[i % streams.length] }));

function input(n: number, subjectCount: number, streams = ["A"], over: Partial<RawMarkSheetInput> = {}): RawMarkSheetInput {
  const ss = subj(subjectCount);
  const st = students(n, streams);
  const marks = st.flatMap((s, i) => ss.map((sub, j) => ({ studentId: s.id, subjectId: sub.id, rawScore: Math.min(sub.maxScore, (i * 7 + j * 13) % (sub.maxScore + 1)), bandLabel: null, bandLevel: null })));
  // Ties on purpose: every pair of neighbouring learners shares a position.
  const rankings = st.map((s, i) => ({ studentId: s.id, totalScore: 0, averageScore: 100 - Math.floor(i / 2) * 0.5, rankInStream: Math.floor(i / 2) * 2 + 1, rankInClass: Math.floor(i / 2) * 2 + 1 }));
  return { school, exam: { name: "CAT 1", examType: "cat", status: "closed", termName: "Term 2", academicYearName: "2026" }, classLabel: "Grade 6", subjects: ss, students: st, marks, rankings, generatedAt: "2026-10-19T08:00:00Z", preparedBy: "Ms Wanjiku", ...over };
}

async function render(raw: RawMarkSheetInput, options?: MarkSheetOptions) {
  const model = buildMarkSheetModel(raw, options);
  const doc = await buildMeritListPdf(model, buildMeritList(model), null);
  const pdf = await getDocumentProxy(new Uint8Array(doc.output("arraybuffer")));
  const { text, totalPages } = await extractText(pdf, { mergePages: true });
  return { doc, text: Array.isArray(text) ? text.join("\n") : text, totalPages };
}
const OUT = "/tmp/merit-samples";
const save = (name: string, doc: Awaited<ReturnType<typeof render>>["doc"]) => {
  mkdirSync(OUT, { recursive: true });
  writeFileSync(`${OUT}/${name}.pdf`, Buffer.from(doc.output("arraybuffer")));
};

describe("buildMeritListPdf", () => {
  it("prints a titled merit list with positions, learners, subject performance and notes as selectable text", async () => {
    const { doc, text } = await render(input(10, 4));
    save("merit-basic", doc);
    for (const expected of ["Gititu High School", "MERIT LIST", "CAT 1", "Term 2, 2026", "First0 Last000", "A1000", "Subject performance", "Highest (by)", "Lowest (by)", "Learners with equal Avg % share a position", "Prepared by", "Page 1 of"]) {
      expect(text).toContain(expected);
    }
  });

  it("with ranking switched off it is an Examination Results list: no positions, alphabetical, signatures optional", async () => {
    const { doc, text } = await render(input(6, 3), { rankingEnabled: false, showSignatures: false, showClassStatistics: true });
    save("results-ranking-off", doc);
    expect(text).toContain("EXAMINATION RESULTS");
    expect(text).not.toContain("MERIT LIST");
    expect(text).not.toMatch(/\bPos\b/);
    expect(text).toContain("this school has ranking switched off");
    expect(text).not.toContain("Prepared by");
  });

  it("flags incomplete results with *, lists learners with no result as unranked, and never prints a zero for missing", async () => {
    const raw = input(5, 3);
    raw.marks = raw.marks.filter((m) => m.studentId !== "st4" && !(m.studentId === "st1" && m.subjectId === "s0")); // st4: no marks; st1: no Maths
    raw.rankings = raw.rankings.filter((r) => r.studentId !== "st4");
    const { doc, text } = await render(raw);
    save("merit-incomplete-noresult", doc);
    expect(text).toContain("First1 Last001 *");
    expect(text).toContain("First4 Last004 (no result)");
    expect(text).toContain("results incomplete (fewer subjects entered than examined; 1 learner)"); // the no-result learner is not also counted
    expect(text).toContain("has no marks yet and is not ranked");
  });

  it("shows class and stream positions when the class has several streams", async () => {
    const { doc, text } = await render(input(10, 3, ["East", "West"]));
    save("merit-two-streams", doc);
    expect(text).toContain("Pos");
    expect(text).toContain("(class)");
    expect(text).toContain("(stream)");
    expect(text).toContain("Pos (class) is across all streams");
  });

  it("paginates a long class: every learner present, table header repeats, page X of Y on every page", async () => {
    const { doc, text, totalPages } = await render(input(120, 5, ["East", "West"]));
    save("merit-long", doc);
    expect(totalPages).toBeGreaterThan(2);
    for (let i = 0; i < 120; i += 1) expect(text).toContain(`Last${String(i).padStart(3, "0")}`);
    for (let p = 1; p <= totalPages; p += 1) expect(text).toContain(`Page ${p} of ${totalPages}`);
    expect((text.match(/Adm No/g) ?? []).length).toBeGreaterThanOrEqual(totalPages - 2);
  });

  it("an open exam is labelled provisional", async () => {
    const raw = input(4, 3);
    raw.exam = { ...raw.exam, status: "open" };
    const { text } = await render(raw);
    expect(text).toContain("PROVISIONAL");
  });
});
