-- student_subjects: record the class an enrolment was set up for, and guard cross-school student ids.
-- (PR 3a of 4 for per-student subject enrolment; the table shipped in 20261018201500.)
--
-- Why class_id: a subject is "selective" for a class once any of that class's students has an enrolment
-- row for it (see src/lib/academics/subject-enrolment.ts). Rows are read per class, and classes already
-- belong to one academic year, so promotion at rollover is naturally safe. But a student corrected into a
-- different class in the SAME year would carry a stale row that made the subject look selective for every
-- student of the new class and blank its mark-entry roster. Recording the class on each row, and reading only
-- rows for the class being viewed, removes that failure mode.
--
-- THIS MIGRATION CHANGES NO BEHAVIOUR. Nothing writes student_subjects yet (production has 0 rows), and the
-- column is nullable: a row with no class_id is simply ignored by the read path, i.e. treated as if absent,
-- which means "everyone takes the subject" -- today's behaviour.
--
-- Additive only: one nullable column, one index, one trigger. No existing column, policy or row changes.
-- Safe to run twice.
--
-- N1 same-school guard: like every other user-writable table with school_id + student_id (see
-- 20261003140000_enforce_student_same_school.sql), reject a row whose student belongs to another school.
-- The function already exists; this only attaches it. It runs on INSERT, and on UPDATE only when student_id
-- or school_id changes, so toggling is_active can never be blocked by it.
--
-- Rollback:
--   drop trigger if exists trg_enforce_student_same_school on public.student_subjects;
--   drop index if exists public.student_subjects_class_year_idx;
--   alter table public.student_subjects drop column if exists class_id;

alter table public.student_subjects
  add column if not exists class_id uuid references public.classes(id) on delete cascade;

comment on column public.student_subjects.class_id is
  'The class this enrolment was set up for. A subject is selective for a class only through rows with that class_id, so a student later moved to another class cannot make a subject look selective there. Null rows are ignored by the read path.';

create index if not exists student_subjects_class_year_idx
  on public.student_subjects (class_id, academic_year_id);

drop trigger if exists trg_enforce_student_same_school on public.student_subjects;
create trigger trg_enforce_student_same_school
  before insert or update of student_id, school_id on public.student_subjects
  for each row execute function public.enforce_student_same_school();
