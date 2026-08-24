-- Bug: admission_number was assigned the instant a `students` row was created (wizard Step 2
-- "Student"), via a BEFORE INSERT trigger -- long before Complete Enrollment (Step 9) ever
-- runs. That means: (a) an admission abandoned partway through still permanently burns a
-- real sequential admission number, and (b) the number shown to staff mid-wizard is not
-- actually "issued" yet in any meaningful sense, even though it looks final.
--
-- The wizard's own UI (wizard-data.ts / step-forms.tsx) already treats admission_number as
-- nullable and falls back to "Assigning…" -- strongly suggesting deferred assignment was
-- always the intent, and the BEFORE INSERT trigger (20260816070422) regressed it.
--
-- Fix: admission_number becomes nullable. The trigger only assigns a real number once a
-- student's status first becomes 'enrolled'/'active' -- i.e. at Complete Enrollment, the
-- last step before a student is enrolled -- covering both direct-active inserts (seed/demo
-- data) and the wizard's approved -> enrolled -> active transition.

alter table public.students alter column admission_number drop not null;

create or replace function public.assign_admission_number()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_next int;
begin
  -- Only assign once the student is actually enrolling as enrolled/active. A student created
  -- mid-admission (status 'applied'/'approved', e.g. by the Admissions wizard before Complete
  -- Enrollment) is left with a null admission_number until enrollment actually completes.
  -- Normalize blank/whitespace to a true null (not '') -- the wizard's insert always sends ""
  -- (never null) for a new student, and (school_id, admission_number) is unique: two interim
  -- admissions both left at '' would collide on that constraint, while multiple nulls do not.
  if new.status not in ('enrolled', 'active') then
    new.admission_number := nullif(trim(coalesce(new.admission_number, '')), '');
    return new;
  end if;

  if new.admission_number is not null and length(trim(new.admission_number)) > 0 then
    return new;
  end if;

  -- Serialize concurrent inserts/updates for the same school so two simultaneous
  -- enrollments can never compute the same "next" number.
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
  'BEFORE INSERT/UPDATE trigger: fills students.admission_number automatically (max numeric admission_number for the school + 1, per-school advisory-locked to stay race-safe) the moment a student''s status first becomes enrolled/active -- not at row creation. A student created mid-admission (status applied/approved) is left with a null admission_number until Complete Enrollment actually runs, so abandoned/draft admissions never burn a real sequential number.';

drop trigger if exists trg_assign_admission_number on public.students;
create trigger trg_assign_admission_number
  before insert on public.students
  for each row execute function public.assign_admission_number();

-- Fires the same assignment logic on the approved->enrolled (and any ...->active) transition
-- that Complete Enrollment performs via plain UPDATEs, so no change to complete_enrollment()
-- itself is needed -- it already does `update students set status = 'enrolled' ...` followed
-- by `update students set status = 'active' ...`, and this trigger assigns the number on
-- whichever of those first flips status into ('enrolled','active').
drop trigger if exists trg_assign_admission_number_on_status_change on public.students;
create trigger trg_assign_admission_number_on_status_change
  before update on public.students
  for each row
  when (new.status is distinct from old.status)
  execute function public.assign_admission_number();
