// Glue between the exam workflow (an exam's mark sheets: one per class + subject) and exam papers,
// so papers read as a step of the exam rather than a separate module.

export interface LinkedPaper {
  id: string;
  title: string;
  status: "draft" | "approved";
  total_marks: number;
  class_id: string;
  subject_id: string;
}

export function sheetKey(classId: string, subjectId: string): string {
  return `${classId}__${subjectId}`;
}

/** Papers linked to an exam, grouped per mark sheet (class + subject); approved papers first. */
export function groupPapersBySheet(papers: LinkedPaper[]): Map<string, LinkedPaper[]> {
  const out = new Map<string, LinkedPaper[]>();
  for (const p of papers) {
    const key = sheetKey(p.class_id, p.subject_id);
    out.set(key, [...(out.get(key) ?? []), p]);
  }
  for (const [key, list] of out) {
    out.set(key, [...list].sort((a, b) => Number(b.status === "approved") - Number(a.status === "approved")));
  }
  return out;
}

/** Deep link into the generator with the exam, class and subject already chosen. */
export function generatePaperHref(examId: string, classId: string, subjectId: string): string {
  const q = new URLSearchParams({ exam: examId, class: classId, subject: subjectId });
  return `/exams/papers?${q.toString()}`;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Reads ?exam=&class=&subject= from the papers page; null unless all three are well-formed ids. */
export function parsePaperPrefill(params: { exam?: string; class?: string; subject?: string }): {
  examId: string;
  classId: string;
  subjectId: string;
} | null {
  const { exam, class: cls, subject } = params;
  if (!exam || !cls || !subject) return null;
  if (!UUID.test(exam) || !UUID.test(cls) || !UUID.test(subject)) return null;
  return { examId: exam, classId: cls, subjectId: subject };
}
