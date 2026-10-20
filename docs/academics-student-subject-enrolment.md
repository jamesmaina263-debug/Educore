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

1. **Schema (shipped, #636):** the table, indexes, policies. Inserts no rows; nothing read it, so behaviour was unchanged.
2. **Read path (this PR):** the rule lives in `src/lib/academics/subject-enrolment.ts`, rows are read by
   `load-subject-enrolment.ts`. Used by:
   - the mark-entry roster (only learners who take the subject; anyone already marked stays listed);
   - the class mark sheet (PDF, Excel, CSV): `n/a` for a subject the learner does not take, `expected` and
     "incomplete" per learner, "missing" and "marks entered x/y" counted over the learners who take the subject;
   - the exam overview progress (`entered / total`).

   Not changed, on purpose: rankings (marks that do not exist already drop out of them, and the formula is owned by
   `class_rankings`), and individual report cards (they list the marks a learner has, so a subject they do not take
   never appears). With no rows, or on any read problem, every learner takes every subject, i.e. today's behaviour.
   The common case costs one small extra query per page.
3. **Assignment screen (shipped, #656 and #666):** `/academics/subject-enrolment`. Staff pick a class, then per
   subject choose who takes it, or make everyone take it again. Needs `academics.write`. Un-enrolling is an
   `is_active = false` row; ticking everyone deletes the rows, so the subject is universal again and later admissions
   are included. Rows carry `class_id` and are read per class.
4. **Follow-ups:**
   - Shipped (#668): mark entry shows a notice with the count of learners not yet assigned to a selective subject
     (e.g. admitted after it was set up); they are not listed until staff assign them.
   - **Planned, not built: copy-from-last-year.** Decision (2026-10-20): not in the rollover database function (it runs
     for every school and changing it needs owner approval). Build it later as a "Copy from last year" button on the
     Subject Enrolment screen with a preview and a confirm step, copying only subjects taught in the new class, once
     schools are actually using electives. Until then, new-year classes start with every subject open to everyone;
     rankings, averages, report cards and the portal are unaffected, only the mark sheet and exam overview counts look
     incomplete until electives are re-set. The rollover page carries a reminder.
   - Also open: guardian/student portal read policy if needed, exam timetable clash checks.

Open decisions (defaults in brackets): ranking across different subject mixes [plain average of entered marks, rank
marked provisional when marks are missing]; elective changes during a term [allowed, history protected as above];
electives taught across streams [not supported yet; confirm with real schools before building teaching groups].
