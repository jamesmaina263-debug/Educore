import { describe, expect, it } from "vitest";
import { generatePaperHref, groupPapersBySheet, parsePaperPrefill, sheetKey, type LinkedPaper } from "./exam-paper-links";

const A = "11111111-1111-4111-8111-111111111111";
const B = "22222222-2222-4222-8222-222222222222";
const C = "33333333-3333-4333-8333-333333333333";
const paper = (id: string, status: "draft" | "approved", class_id = A, subject_id = B): LinkedPaper => ({
  id,
  title: `Paper ${id}`,
  status,
  total_marks: 30,
  class_id,
  subject_id,
});

describe("groupPapersBySheet", () => {
  it("groups per class+subject and lists approved papers first", () => {
    const m = groupPapersBySheet([paper("d", "draft"), paper("a", "approved"), paper("x", "draft", C, B)]);
    expect(m.get(sheetKey(A, B))?.map((p) => p.id)).toEqual(["a", "d"]);
    expect(m.get(sheetKey(C, B))?.map((p) => p.id)).toEqual(["x"]);
    expect(m.get(sheetKey(A, C))).toBeUndefined();
  });
});

describe("generatePaperHref / parsePaperPrefill", () => {
  it("round-trips the three ids", () => {
    const href = generatePaperHref(A, B, C);
    expect(href.startsWith("/exams/papers?")).toBe(true);
    const q = new URLSearchParams(href.split("?")[1]);
    expect(parsePaperPrefill({ exam: q.get("exam")!, class: q.get("class")!, subject: q.get("subject")! })).toEqual({
      examId: A,
      classId: B,
      subjectId: C,
    });
  });

  it("rejects missing or malformed ids", () => {
    expect(parsePaperPrefill({})).toBeNull();
    expect(parsePaperPrefill({ exam: A, class: B })).toBeNull();
    expect(parsePaperPrefill({ exam: A, class: B, subject: "not-an-id" })).toBeNull();
  });
});
