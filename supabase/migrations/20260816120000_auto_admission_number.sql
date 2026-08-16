-- Rectify: admission numbers were free-typed on both entry points (manual /students/new
-- and the admissions wizard's Step 2), which is exactly how the live data ended up with a
-- gap (7338, 7339, 7340, 7342, 7343 -- 7341 was never used, a plain human typo/skip).
-- Fix: the school's next admission number is now always computed automatically -- the UI no
-- longer accepts free typing for it at all (see the two client changes in this commit).
--
-- Design: a BEFORE INSERT trigger on students, not application-code max+1, so this is
-- correct and race-safe regardless of which entry point creates the student, and correct
-- even if a future entry point is added later without remembering to call anything special.
-- A per-school pg_advisory_xact_lock serializes concurrent inserts for the same school so two
-- staff finishing enrollment at the same moment can never be handed the same number.
--
-- Numbering resumes from whatever a school's data already looks like (max numeric-looking
-- admission_number + 1); a brand-new school with no students starts at 1. Only values that are
-- purely digits are considered "numeric" for max() purposes, so a school that free-typed something
-- non-numeric in the past (there are none currently, but nothing guarantees it can't happen before
-- this migration) can't corrupt the sequence for everyone else.

create or replace function public.assign_admission_number()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_next int;
begin
  if new.admission_number is not null and length(trim(new.admission_number)) > 0 then
    return new;
  end if;

  -- Serialize concurrent inserts for the same school so two simultaneous enrollments
  -- can never compute the same "next" number.
  perform pg_advisory_xact_lock(hashtext(new.school_id::text));

  select coalesce(max(admission_number::int), 0) + 1
    into v_next
    from public.students
    where school_id = new.school_id
      and admission_number ~ '^[0-9]+$';

  new.admission_number := v_next::text;
  return new;
end;
$$;

comment on function public.assign_admission_number is
  'BEFORE INSERT trigger: fills students.admission_number automatically (max numeric admission_number for the school + 1, per-school advisory-locked to stay race-safe) whenever the client sends it null/blank. The client-side forms no longer offer a free-typing field for this -- see students/new and the admissions wizard.';

drop trigger if exists trg_assign_admission_number on public.students;
create trigger trg_assign_admission_number
  before insert on public.students
  for each row execute function public.assign_admission_number();

-- Read-only preview so the UI can *show* the number that will be assigned before the student
-- is actually created (nice for the form, not load-bearing -- the trigger above is what
-- actually guarantees correctness/race-safety at insert time; this can theoretically race
-- with a concurrent insert between the preview and the real submit, which is fine since it's
-- only ever a display value, never trusted as an input).
create or replace function public.next_admission_number()
returns text
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_school_id uuid := auth_school_id();
  v_next int;
begin
  if v_school_id is null then
    raise exception 'Could not resolve your school.';
  end if;

  select coalesce(max(admission_number::int), 0) + 1
    into v_next
    from public.students
    where school_id = v_school_id
      and admission_number ~ '^[0-9]+$';

  return v_next::text;
end;
$$;

revoke all on function public.next_admission_number() from public;
grant execute on function public.next_admission_number() to authenticated;

comment on function public.next_admission_number is
  'Read-only preview of the admission number that will be auto-assigned to the next student created at the caller''s school. Display-only -- see assign_admission_number() for the actual race-safe assignment at insert time.';
