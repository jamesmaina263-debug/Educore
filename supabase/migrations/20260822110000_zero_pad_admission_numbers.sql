-- James: admission numbers should read 001, 002, 003... not 1, 2, 3.
-- Applies to both the real assignment (assign_admission_number, fires at Complete
-- Enrollment per the previous migration) and the wizard's live preview
-- (next_admission_number). Zero-padded to a minimum of 3 digits; a school that
-- passes 999 students just grows to 4+ digits naturally (lpad only pads up, never
-- truncates), no format cliff.

create or replace function public.assign_admission_number()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_next int;
begin
  if new.status not in ('enrolled', 'active') then
    new.admission_number := nullif(trim(coalesce(new.admission_number, '')), '');
    return new;
  end if;

  if new.admission_number is not null and length(trim(new.admission_number)) > 0 then
    return new;
  end if;

  perform pg_advisory_xact_lock(hashtext(new.school_id::text));

  select coalesce(max(admission_number::int), 0) + 1
    into v_next
    from public.students
    where school_id = new.school_id
      and admission_number ~ '^[0-9]+$';

  new.admission_number := lpad(v_next::text, 3, '0');
  return new;
end;
$$;

comment on function public.assign_admission_number is
  'BEFORE INSERT/UPDATE trigger: fills students.admission_number automatically (max numeric admission_number for the school + 1, zero-padded to 3+ digits, per-school advisory-locked to stay race-safe) the moment a student''s status first becomes enrolled/active -- not at row creation. A student created mid-admission (status applied/approved) has its admission_number normalized to null until Complete Enrollment actually runs, so abandoned/draft admissions never burn a real sequential number and never collide with each other on the (school_id, admission_number) unique constraint.';

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

  return lpad(v_next::text, 3, '0');
end;
$$;

comment on function public.next_admission_number is
  'Read-only preview of the admission number that will be auto-assigned to the next student created at the caller''s school, zero-padded to 3+ digits. Display-only -- see assign_admission_number() for the actual race-safe assignment at Complete Enrollment.';
