import { describe, it, expect } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { ReportCardDocumentSet } from "./report-card-document";
import type { ReportCardDocumentData } from "@/lib/academics/report-card-document";
import { EMPTY_REPORT_FORM_LAYOUT } from "@/lib/academics/report-form-layout";

// WP 7.7: a school's own wording on the printed card, and proof that no layout = the original card.

const doc = (over: Partial<ReportCardDocumentData> = {}): ReportCardDocumentData => ({
  school: { name: "Gititu High", logoUrl: null, primaryColor: "#123456", address: "Box 1", phone: "0700" },
  exam: { id: "e1", name: "Mid-term", termName: "Term 2" },
  details: { assessment: "Mid-term (Exam)", termYear: "Term 2, 2027", grading: "Numeric", generatedAt: "2026-10-18T12:00:00.000Z", classSize: 2 },
  student: { id: "s1", fullName: "Amy Abel", admissionNumber: "1", classLabel: "Grade 6 A" },
  subjects: [{ subject: "Mathematics", score: 80, grade: "A" }],
  competencies: [],
  average: 80,
  rank: 1,
  released: true,
  comment: "Excellent progress",
  attendance: null,
  headTeacherComment: "Keep it up",
  options: { showRank: true, showCompetencies: true, showSignatures: true, showAcknowledgement: true },
  ...over,
});
const html = (d: ReportCardDocumentData) => renderToStaticMarkup(<ReportCardDocumentSet docs={[d]} backHref="/x" />);

describe("report card wording (WP 7.7)", () => {
  it("renders exactly the same card with no layout, a null layout, or an all-default layout", () => {
    const base = html(doc());
    expect(html(doc({ layout: null }))).toBe(base);
    expect(html(doc({ layout: EMPTY_REPORT_FORM_LAYOUT }))).toBe(base);
    expect(base).toContain("Report Card · Mid-term");
    expect(base).toContain("Class teacher&#x27;s comment");
    expect(base).toContain("Head teacher&#x27;s comment");
    expect(base).toContain("Parent / Guardian acknowledgement");
    expect(base).toContain("Principal (signature &amp; date)");
  });

  it("uses the school's title, subtitle and footer note", () => {
    const out = html(doc({ layout: { ...EMPTY_REPORT_FORM_LAYOUT, title: "Progress Report", subtitle: "Excellence in all things", footerNote: "Term 3 opens 4 January." } }));
    expect(out).toContain("Progress Report · Mid-term");
    expect(out).not.toContain("Report Card · Mid-term");
    expect(out).toContain("Excellence in all things");
    expect(out).toContain("Term 3 opens 4 January.");
  });

  it("uses the school's signature and comment labels", () => {
    const out = html(doc({ layout: { ...EMPTY_REPORT_FORM_LAYOUT, classTeacherLabel: "Form tutor", headTeacherLabel: "Head of school", parentLabel: "Guardian" } }));
    expect(out).toContain("Form tutor (signature &amp; date)");
    expect(out).toContain("Head of school (signature &amp; date)");
    expect(out).toContain("Guardian (signature &amp; date)");
    expect(out).toContain("Form tutor&#x27;s comment");
    expect(out).toContain("Head of school&#x27;s comment");
    expect(out).toContain("Guardian acknowledgement");
    expect(out).not.toContain("Principal (signature");
  });

  it("escapes markup in school-supplied text", () => {
    const out = html(doc({ layout: { ...EMPTY_REPORT_FORM_LAYOUT, footerNote: "<script>alert(1)</script>", title: "<b>x</b>" } }));
    expect(out).not.toContain("<script>alert(1)</script>");
    expect(out).toContain("&lt;script&gt;");
    expect(out).not.toContain("<b>x</b>");
  });

  it("never changes marks, rank or the draft banner", () => {
    const out = html(doc({ released: false, comment: null, layout: { ...EMPTY_REPORT_FORM_LAYOUT, title: "Custom" } }));
    expect(out).toContain("DRAFT");
    expect(out).toContain("Mathematics");
    expect(out).toContain("Pending approval.");
  });
});
