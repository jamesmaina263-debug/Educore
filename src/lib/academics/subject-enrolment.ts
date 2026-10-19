// Which students take which subjects. Pure rules, no I/O; the loader is load-subject-enrolment.ts and the
// design note is docs/academics-student-subject-enrolment.md.
//
// The rule (kept in this one place so mark entry, the mark sheet and the exam overview cannot disagree):
//  * A subject with NO enrolment rows is universal: every student takes it. This is how every school behaves
//    today, so with an empty student_subjects table nothing changes anywhere.
//  * A subject with at least one enrolment row is selective: a student takes it only if they have an
//    is_active row for it.
//  * A student who already has a mark in a subject always counts as taking it, whatever the rows say. A later
//    elective change therefore can never hide, or change the meaning of, results that already exist.
//
// Callers must pass only the rows for the students being looked at (one class) and for one academic year.
// Passing another class's rows would make a subject look selective where it is not.

export interface EnrolmentRow {
  studentId: string;
  subjectId: string;
  isActive: boolean;
}

export interface SubjectEnrolment {
  /** True when this student takes this subject. */
  takes(studentId: string, subjectId: string): boolean;
  /** True when staff have set this subject up as selective (it has enrolment rows). */
  isSelective(subjectId: string): boolean;
}

/** Today's behaviour: everyone takes everything. Also what every failure path falls back to. */
export const EVERYONE_TAKES_EVERYTHING: SubjectEnrolment = {
  takes: () => true,
  isSelective: () => false,
};

const keyOf = (studentId: string, subjectId: string) => `${studentId}:${subjectId}`;

export function buildSubjectEnrolment(rows: EnrolmentRow[], marks: { studentId: string; subjectId: string }[] = []): SubjectEnrolment {
  if (rows.length === 0) return EVERYONE_TAKES_EVERYTHING;

  const selective = new Set<string>();
  const active = new Set<string>();
  for (const r of rows) {
    selective.add(r.subjectId);
    if (r.isActive) active.add(keyOf(r.studentId, r.subjectId));
  }
  const marked = new Set(marks.map((m) => keyOf(m.studentId, m.subjectId)));

  return {
    isSelective: (subjectId) => selective.has(subjectId),
    takes: (studentId, subjectId) => {
      if (!selective.has(subjectId)) return true;
      const key = keyOf(studentId, subjectId);
      return active.has(key) || marked.has(key);
    },
  };
}
