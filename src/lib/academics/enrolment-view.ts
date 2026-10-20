import type { EnrolmentRow } from "@/lib/academics/subject-enrolment";

// What the "Subject Enrolment" screen shows for one class: for each subject, whether it is selective and who
// takes it. Pure; the rows must already be for this class and academic year (loadEnrolmentRows does that).

export interface SubjectEnrolmentView {
  subjectId: string;
  selective: boolean;
  /** Students who take the subject. Everyone for a universal subject. */
  takingIds: string[];
  /** Selective subject only: students with no row yet (e.g. admitted after it was set up). They count as not taking it. */
  notSetIds: string[];
}

export function buildEnrolmentView(subjectIds: string[], studentIds: string[], rows: EnrolmentRow[]): SubjectEnrolmentView[] {
  const bySubject = new Map<string, Map<string, boolean>>();
  for (const r of rows) {
    const m = bySubject.get(r.subjectId) ?? new Map<string, boolean>();
    m.set(r.studentId, r.isActive);
    bySubject.set(r.subjectId, m);
  }
  return subjectIds.map((subjectId) => {
    const m = bySubject.get(subjectId);
    if (!m) return { subjectId, selective: false, takingIds: [...studentIds], notSetIds: [] };
    return {
      subjectId,
      selective: true,
      takingIds: studentIds.filter((id) => m.get(id) === true),
      notSetIds: studentIds.filter((id) => !m.has(id)),
    };
  });
}
