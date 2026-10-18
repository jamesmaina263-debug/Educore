-- Per-student subject enrolment (PR 1 of 4: schema only).
--
-- Why: today every student in a class is assumed to sit every subject the class is examined in. That breaks
-- for CBC senior school pathways and Form 3-4 optional subjects, where students in one class take different
-- subjects. This table records which students take a SELECTIVE subject in an academic year.
--
-- THIS MIGRATION CHANGES NO EXISTING BEHAVIOUR AND INSERTS NO ROWS. Nothing reads student_subjects yet:
-- marks, exams, rankings, mark sheets and report cards are untouched.
--
-- Model (used by the later read-path PR):
--   * A subject with NO rows here for a class's students in an academic year is universal: every student of
--     the class takes it, exactly as today. So every existing school keeps working with no data migration.
--   * Once a subject has rows for a class's students in a year, it is selective: only students with an
--     is_active = true row take it. Staff switch a subject to selective in the assignment screen, which
--     writes a row for EVERY student of the class (active for those who take it, inactive for those who do
--     not), so "selective with nobody ticked" is still representable. Hence: deactivate, never delete.
--
-- Additive only: one new table, its indexes, trigger and policies. No existing table, column, policy or
-- function is altered or dropped, and there is deliberately no trigger on students, class_subjects or marks.
-- Safe to run twice: every statement is guarded.

create table if not exists public.student_subjects (
  id uuid primary key default gen_random_uuid(),
  school_id uuid not null references public.schools(id) on delete cascade,
  student_id uuid not null references public.students(id) on delete cascade,
  subject_id uuid not null references public.subjects(id) on delete cascade,
  academic_year_id uuid not null references public.academic_years(id) on delete cascade,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (student_id, subject_id, academic_year_id)
);

comment on table public.student_subjects is
  'Which students take a selective subject in an academic year. A subject with no rows for a class in a year is universal (everyone takes it); once it has rows it is selective and only is_active rows take it. Deactivate with is_active instead of deleting so a subject stays selective. Not read by marks, rankings or report cards until the read-path PR.';

create index if not exists student_subjects_school_idx on public.student_subjects (school_id);
create index if not exists student_subjects_subject_year_idx on public.student_subjects (subject_id, academic_year_id);
create index if not exists student_subjects_year_idx on public.student_subjects (academic_year_id);

drop trigger if exists trg_student_subjects_updated_at on public.student_subjects;
create trigger trg_student_subjects_updated_at
  before update on public.student_subjects
  for each row execute function public.set_updated_at();

alter table public.student_subjects enable row level security;

revoke all on public.student_subjects from anon;

-- Same access model as class_subjects: school-scoped, academics.read to read, academics.write to change.
drop policy if exists student_subjects_select on public.student_subjects;
create policy student_subjects_select on public.student_subjects for select
  using (auth_is_super_admin() or (school_id = auth_school_id() and auth_has_permission('academics.read')));

drop policy if exists student_subjects_insert on public.student_subjects;
create policy student_subjects_insert on public.student_subjects for insert
  with check (auth_is_super_admin() or (school_id = auth_school_id() and auth_has_permission('academics.write')));

drop policy if exists student_subjects_update on public.student_subjects;
create policy student_subjects_update on public.student_subjects for update
  using (auth_is_super_admin() or (school_id = auth_school_id() and auth_has_permission('academics.write')))
  with check (auth_is_super_admin() or (school_id = auth_school_id() and auth_has_permission('academics.write')));

drop policy if exists student_subjects_delete on public.student_subjects;
create policy student_subjects_delete on public.student_subjects for delete
  using (auth_is_super_admin() or (school_id = auth_school_id() and auth_has_permission('academics.write')));
