import { describe, it, expect } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { ReportCardDocumentSet } from "./report-card-document";
import type { ReportCardDocumentData } from "@/lib/academics/report-card-document";

const doc = (over: Partial<ReportCardDocumentData> = {}): ReportCardDocumentData => ({
  school: { name: "Gititu High", logoUrl: "https://x/logo.png", primaryColor: "#123456", address: "Box 1", phone: "0700" },
  exam: { id: "e1", name: "Mid-term", termName: "Term 2" },
  student: { id: "s1", fullName: "Amy Abel", admissionNumber: "1", classLabel: "Grade 6 A" },
  subjects: [{ subject: "Mathematics", score: null, grade: "A — Exceeding Expectation" }],
  competencies: [],
  average: 70,
  rank: 2,
  released: true,
  comment: "Excellent progress",
  ...over,
});

const html = (docs: ReportCardDocumentData[]) => renderToStaticMarkup(<ReportCardDocumentSet docs={docs} backHref="/x" />);

describe("ReportCardDocumentSet", () => {
  it("renders the school logo, name, marks, rank and the approved comment", () => {
    const out = html([doc()]);
    expect(out).toContain('src="https://x/logo.png"');
    expect(out).toContain("Gititu High");
    expect(out).toContain("Mathematics");
    expect(out).toContain("A — Exceeding Expectation");
    expect(out).toContain("Excellent progress");
    expect(out).not.toContain("DRAFT");
  });
  it("marks an unreleased card as a draft and prints no comment text", () => {
    const out = html([doc({ released: false, comment: null })]);
    expect(out).toContain("DRAFT");
    expect(out).toContain("Pending approval.");
  });
  it("hides the Back link / print toolbar when printing (inline display must not defeat it)", () => {
    const out = html([doc()]);
    expect(out).toContain("rc-toolbar");
    expect(out).toMatch(/@media print[\s\S]*\.rc-toolbar\s*\{\s*display:\s*none\s*!important/);
  });
  it("renders one page per student and omits the logo when the school has none", () => {
    const out = html([doc(), doc({ student: { id: "s2", fullName: "Ben Bett", admissionNumber: "2", classLabel: "Grade 6 A" }, school: { name: "Gititu High", logoUrl: null, primaryColor: null, address: null, phone: null } })]);
    expect((out.match(/report-card-page/g) ?? []).length).toBeGreaterThanOrEqual(2);
    expect(out).toContain("Ben Bett");
  });
});
