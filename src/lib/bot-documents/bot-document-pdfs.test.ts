import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { extractText, getDocumentProxy } from "unpdf";
import { buildReportCardPdf } from "@/lib/pdf/report-card-pdf";
import { buildStatementPdf } from "@/lib/pdf/student-statement-pdf";
import { buildStatementModel } from "./student-statement";
import type { ReportCardDocumentData } from "@/lib/academics/report-card-document";

async function textOf(doc: { output: (t: "arraybuffer") => ArrayBuffer }) {
  const pdf = await getDocumentProxy(new Uint8Array(doc.output("arraybuffer")));
  const { text } = await extractText(pdf, { mergePages: true });
  return text as string;
}

const card = (over: Partial<ReportCardDocumentData> = {}): ReportCardDocumentData => ({
  school: { name: "Demo Academy", logoUrl: null, primaryColor: "#1e293b", address: "P.O. Box 1", phone: "0700 000 000" },
  exam: { id: "e1", name: "End of Term 2", termName: "Term 2" },
  details: { assessment: "End of Term 2 Examination", termYear: "Term 2, 2026", grading: "Marks", generatedAt: "2026-11-02T08:00:00Z", classSize: 40 },
  student: { id: "s1", fullName: "Sam One", admissionNumber: "A1", classLabel: "Grade 6 East" },
  subjects: [
    { subject: "Mathematics", score: 78, grade: "EE" },
    { subject: "English", score: 64, grade: "ME" },
  ],
  competencies: [],
  average: 71,
  rank: 3,
  released: true,
  comment: "A pleasing term. Keep it up.",
  attendance: null,
  headTeacherComment: null,
  options: { showRank: true, showCompetencies: true, showSignatures: false, showAcknowledgement: false },
  ...over,
});

describe("buildReportCardPdf", () => {
  it("prints the learner, marks, position and the released comment", async () => {
    const t = await textOf(await buildReportCardPdf(card()));
    for (const s of ["LEARNER REPORT CARD", "Demo Academy", "Sam One", "A1", "Mathematics", "78", "English", "Average: 71", "Position: 3 of 40", "A pleasing term"]) expect(t).toContain(s);
  });
  it("leaves out position when the school switched ranking off, and the comment when there is none", async () => {
    const t = await textOf(await buildReportCardPdf(card({ options: { showRank: false, showCompetencies: true, showSignatures: false, showAcknowledgement: false }, comment: null })));
    expect(t).not.toContain("Position");
    expect(t).not.toContain("Class teacher's comment");
  });
  it("prints competency ratings for a CBC card", async () => {
    const t = await textOf(
      await buildReportCardPdf(card({ subjects: [{ subject: "Science", score: null, grade: "Meeting Expectation" }], competencies: [{ subject: "Science", strand: "Living things", subStrand: "Plants", rating: "Exceeding" }] })),
    );
    expect(t).toContain("Living things");
    expect(t).toContain("Plants");
    expect(t).toContain("Exceeding");
  });
});

describe("buildStatementPdf", () => {
  it("prints the lines, the term total and the closing balance", async () => {
    const model = buildStatementModel({
      school: { name: "Demo Academy", address: null, phone: null, primaryColor: null },
      student: { fullName: "Sam One", admissionNumber: "A1", classLabel: "Grade 6 East" },
      term: { id: "t2", name: "Term 2", yearName: "2026" },
      invoices: [{ id: "i2", invoiceNumber: "INV-2", termId: "t2", totalAmount: 12000, createdAt: "2026-05-02T00:00:00Z" }],
      discounts: [],
      allocations: [{ paymentId: "p", invoiceId: "i2", amount: 5000, paidAt: "2026-05-10T00:00:00Z", method: "mpesa", reference: "QWE123" }],
      accountBalance: 7000,
      creditBalance: 0,
      generatedAt: "2026-11-02T08:00:00Z",
    })!;
    const t = await textOf(await buildStatementPdf(model));
    for (const s of ["FEE STATEMENT", "Sam One", "Term 2, 2026", "Invoice INV-2", "KES 12,000.00", "M-Pesa QWE123", "KES 5,000.00", "Balance due:", "KES 7,000.00"]) expect(t).toContain(s);
  });
});

// The things that must never regress, checked on the source because they cannot be seen in a unit test.
describe("route and webhook safeguards", () => {
  const route = readFileSync("src/app/api/bot/documents/route.ts", "utf8");
  const webhook = readFileSync("supabase/functions/whatsapp-webhook/index.ts", "utf8");
  it("the PDF route is secret-protected, claims the request once and never logs the signed link", () => {
    expect(route).toContain("isValidCronRequest(request, secret)");
    expect(route).toContain("bot_claim_document_request");
    expect(route).toContain('"bot-documents"');
    expect(route).not.toMatch(/console\.(log|info|warn|error)/);
  });
  it("the webhook hides a PIN from the message log and the conversation preview", () => {
    expect(webhook).toContain("[PIN hidden]");
    expect(webhook).toContain("body: storedBody");
    expect(webhook).toContain("storedBody.slice(0, 140)");
  });
  it("the webhook never stores the signed link and records delivery", () => {
    expect(webhook).toContain("bot_complete_document_request");
    expect(webhook).not.toMatch(/body:\s*result\.document/);
  });
});
