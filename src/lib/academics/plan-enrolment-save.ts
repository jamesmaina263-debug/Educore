// Pure planning for "who takes this subject in this class" -- no I/O, so the rules are testable on their own.
// The server action (academics/subject-enrolment-actions.ts) fetches the class's active students, asks this
// what to write, and writes it.
//
// Why every student gets a row when the subject is selective: the read rules (subject-enrolment.ts) treat a
// student with NO row as "not taking" once the subject is selective, so an explicit row per student keeps the
// saved list unambiguous. Why "everyone" deletes the rows instead: a subject with no rows is universal, so
// students admitted later are included automatically.

export type EnrolmentSavePlan =
  | { ok: false; error: string }
  | { ok: true; mode: "everyone" }
  | { ok: true; mode: "selected"; rows: { studentId: string; isActive: boolean }[] };

export function planEnrolmentSave(activeStudentIds: string[], takingStudentIds: string[]): EnrolmentSavePlan {
  const active = [...new Set(activeStudentIds)];
  if (active.length === 0) return { ok: false, error: "This class has no active students." };

  const activeSet = new Set(active);
  const taking = new Set(takingStudentIds);
  for (const id of taking) {
    if (!activeSet.has(id)) return { ok: false, error: "Some selected students are not in this class. Refresh and try again." };
  }

  if (taking.size === active.length) return { ok: true, mode: "everyone" };
  return { ok: true, mode: "selected", rows: active.map((studentId) => ({ studentId, isActive: taking.has(studentId) })) };
}
