# Per-student subject enrolment

Students in one class do not all take the same subjects (CBC senior school pathways, Form 3-4 optional subjects). This
document records the model so each change that builds on it stays consistent. It ships in four small PRs.

## The model

New table `student_subjects` (migration `20261018201500_student_subjects.sql`): one row per student, subject and
academic year, with `is_active`.

- **Universal by default.** A subject with no `student_subjects` rows for a class's students in an academic year is
  taken by every student of the class, exactly as before. Every existing school keeps working with no data migration.
- **Selective once it has rows.** When a subject has rows for a class's students in a year, only students with an
  `is_active = true` row take it. Staff switch a subject to selective in the assignment screen, which writes a row for
  every student of the class (active for those who take it, inactive for those who do not), so "selective with nobody
  ticked" is still representable.
- **Deactivate, never delete.** Deleting the last row would silently turn a selective subject back into a universal one.
- **Per academic year.** A new year starts universal until electives are set up again.
- **History is protected.** For marks already entered, a student counts as taking the subject if they have a mark in it,
  so changing electives never alters a closed exam, a report card or a ranking that already exists.

Why not enrol every student in every subject up front: `exam_subjects` (what an exam covers per class) and
`class_subjects` (who teaches what per stream) are not guaranteed to match, and some students have no stream subjects
recorded. In production data at the time of writing, one of six exam subject pairs was not in `class_subjects`.
Materialising rows from `class_subjects` would have dropped such subjects for those students.

## Access

Same model as `class_subjects`: `academics.read` to read, `academics.write` to change, scoped by `auth_school_id()`
(super admin bypasses). `anon` has no access. Rows are removed with the student, the subject, the academic year or the
school (cascade). There is deliberately no trigger on `students`, `class_subjects` or `marks`.

## Rollout

1. **Schema (this PR):** the table, indexes, policies. Inserts no rows; nothing reads it, so behaviour is unchanged.
2. **Read path:** mark entry roster, mark sheet `expected` per student, rankings (flag incomplete), report cards, exam
   paper rosters, student profile. A subject with no rows behaves as today.
3. **Assignment screen:** staff set a subject to selective and tick who takes it, singly or in bulk by class.
4. **Follow-ups:** guardian/student portal read policy if needed, copy-from-last-year, exam timetable clash checks.

Open decisions (defaults in brackets): ranking across different subject mixes [plain average of entered marks, rank
marked provisional when marks are missing]; elective changes during a term [allowed, history protected as above];
electives taught across streams [not supported yet; confirm with real schools before building teaching groups].
