import { describe, expect, it } from "vitest";
import { mkdirSync, writeFileSync } from "node:fs";
import { extractText, getDocumentProxy } from "unpdf";
import { buildPerformanceReportPdf } from "./performance-report-pdf";
import { studentReportModel, schoolReportModel } from "@/lib/academics/performance-report-model";
import {
  buildSubjectProgression,
  buildYearlySeries,
  configFor,
  levelBands,
  normaliseMarks,
  summarizeHistory,
  summarizeSchool,
  type PerfMark,
} from "@/lib/academics/performance-analytics";

const school = { name: "Gititu High School", motto: "Excellence in Service", address: "P.O. Box 12", phone: "0700 000 000", email: "info@gititu.ac.ke", primaryColor: "#1e293b" };
const LABELS = ["A — Exceeding", "B — Meeting", "C — Approaching", "D — Below"];

let n = 0;
function lvl(order: number, yearIdx: number, term: number, subject: string, student = "s1"): PerfMark {
  const year = 2024 + yearIdx;
  return {
    studentId: student, classId: "c1", classLabel: "Grade 4", subjectId: subject, subjectName: subject, yearId: `y${year}`, yearName: String(year), yearStart: `${year}-01-01`,
    termNumber: term, examId: `e${n++}`, kind: "level", rawScore: null, maxScore: null, levelOrder: order, levelCount: 4, levelPoints: null, levelLabel: LABELS[order - 1],
  };
}
function pct(raw: number, yearIdx: number, term: number, subject: string, student = "s1"): PerfMark {
  return { ...lvl(1, yearIdx, term, subject, student), kind: "percent", rawScore: raw, maxScore: 100, levelOrder: null, levelCount: null, levelLabel: null };
}

async function textOf(doc: Awaited<ReturnType<typeof buildPerformanceReportPdf>>) {
  const pdf = await getDocumentProxy(new Uint8Array(doc.output("arraybuffer")));
  const { text, totalPages } = await extractText(pdf, { mergePages: true });
  return { text: Array.isArray(text) ? text.join("\n") : text, totalPages };
}

describe("buildPerformanceReportPdf", () => {
  it("renders a CBC student history with selectable text and charts", async () => {
    const marks = normaliseMarks(
      [
        ...[1, 2, 3].flatMap((t) => [lvl(4, 0, t, "Mathematics"), lvl(3, 0, t, "English")]),
        ...[1, 2, 3].flatMap((t) => [lvl(3, 1, t, "Mathematics"), lvl(2, 1, t, "English")]),
        ...[1, 2].flatMap((t) => [lvl(2, 2, t, "Mathematics"), lvl(1, 2, t, "English")]),
      ],
    );
    const cfg = configFor("level", 4);
    const years = buildYearlySeries(marks);
    const report = studentReportModel({
      studentName: "Test Learner", admissionNumber: "A1001", className: "Grade 4", enrolledOn: "2024-01-15", cfg, years,
      summary: summarizeHistory(marks, years, cfg), subjects: buildSubjectProgression(marks, 3, cfg.stable),
      attendance: { percentage: 94.5, daysRecorded: 120 }, scaleNote: "CBC levels scored A=4 … D=1.",
    });
    const doc = await buildPerformanceReportPdf(report, school, null);
    mkdirSync("/tmp/perf-samples", { recursive: true });
    writeFileSync("/tmp/perf-samples/student-cbc.pdf", Buffer.from(doc.output("arraybuffer")));
    const { text } = await textOf(doc);
    expect(text).toContain("Gititu High School");
    expect(text).toContain("Academic history: Test Learner");
    expect(text).toContain("Growth since enrolment");
    // Levels D,C (1.5) -> C,B (2.5) -> B,A (3.5): a rise of +2 points, i.e. improving, not declining.
    expect(text).toContain("+2 pts");
    expect(text).toContain("Overall average by year");
    expect(text).toContain("Subject progression");
    expect(text).toContain("Mathematics");
    expect(text).toContain("94.5%");
    expect(text).toContain("Years marked incomplete");
  });

  it("renders a percent school report with a category chart", async () => {
    const marks = normaliseMarks([pct(80, 0, 1, "Maths", "a"), pct(40, 0, 1, "English", "b"), pct(90, 1, 1, "Maths", "a"), pct(45, 1, 1, "English", "b")]);
    const cfg = configFor("percent");
    const summary = summarizeSchool(marks, {}, [{ label: "Excellent", min: 80, max: 100, order: 1 }, { label: "Good", min: 40, max: 79.99, order: 2 }], cfg);
    const doc = await buildPerformanceReportPdf(schoolReportModel({ schoolName: school.name, cfg, summary, filterText: "All years", scaleNote: "Percent." }), school, null);
    writeFileSync("/tmp/perf-samples/school-percent.pdf", Buffer.from(doc.output("arraybuffer")));
    const { text } = await textOf(doc);
    expect(text).toContain("Whole-school academic performance");
    expect(text).toContain("School average");
    expect(text).toContain("Students by performance category");
    expect(text).toContain("Maths");
  });

  it("renders an honest empty chart instead of fake data", async () => {
    const cfg = configFor("percent");
    const summary = summarizeSchool([], {}, [], cfg);
    const doc = await buildPerformanceReportPdf(schoolReportModel({ schoolName: school.name, cfg, summary, filterText: "", scaleNote: "" }), school, null);
    const { text } = await textOf(doc);
    expect(text).toContain("No data for the selected filters.");
  });

  it("level bands feed the category chart for CBC", () => {
    const m = normaliseMarks([lvl(1, 0, 1, "M", "a"), lvl(4, 0, 1, "M", "b")]);
    expect(levelBands(m).map((b) => b.label)).toEqual([LABELS[0], LABELS[3]]);
  });
});
