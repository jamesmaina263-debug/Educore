-- Schools migrating from a paper register / previous system need to register students in any
-- order while KEEPING the admission number the student already has (e.g. LB/004/2026 before
-- LB/001/2026). The admissions wizard now lets staff either use the automatic number or type
-- an existing one.
--
-- What already existed and is NOT changed:
--   * students.admission_number is nullable; unique (school_id, admission_number) -- tenant-scoped,
--     so two schools may use the same number.
--   * assign_admission_number() only auto-fills when the number is blank AND the student is
--     becoming enrolled/active; a non-blank value is always preserved as typed (trimmed).
--   * The bulk importer (import_students) already upserts on (school_id, admission_number).
--
-- What this migration changes (function bodies only -- no table, column, constraint or data
-- change, so it is safe to apply to a live database and trivially reversible by re-applying the
-- previous function definitions from 20260822125207 / 20260822100820):
--
--  1. Auto-numbering overflow guard. Auto-numbering takes max(admission_number::int) over
--     all-digit values. Once staff can type numbers, a long all-digit value (e.g. 12 digits)
--     would make the ::int cast raise "out of range" and BREAK automatic numbering for the whole
--     school. Only 1-9 digit values are now considered "numeric" for the max().
--  2. Case-insensitive duplicate guard. The unique constraint is case-sensitive, so "lb/001/2026"
--     and "LB/001/2026" could both exist -- a data-entry trap for a register-driven number. A
--     student can no longer be given a number that differs from another student's in that school
--     only by letter case. Exact duplicates are still rejected by the existing unique constraint
--     (this keeps import_students' ON CONFLICT upsert working unchanged). The check only runs when
--     the value is being set or changed, so existing rows and status-only updates are never
--     re-validated or blocked.
--  3. Never silently regenerate. Clearing the number of a student who already has one is rejected
--     instead of quietly assigning a different one.
--
-- Concurrency: every set/change of a non-blank number, and every auto-assignment, takes the same
-- per-school advisory lock, so a manual entry and an auto-assignment (or two manual entries) for
-- the same school serialize. The unique constraint remains the final backstop.

create or replace function public.assign_admission_number()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_next int;
  v_clash text;
begin
  -- Same normalization as before: trim, and blank -> NULL.
  new.admission_number := nullif(trim(coalesce(new.admission_number, '')), '');

  -- Never silently replace / regenerate an existing number.
  if tg_op = 'UPDATE' and old.admission_number is not null and new.admission_number is null then
    raise exception 'A student''s admission number cannot be cleared once assigned.'
      using errcode = '23514';
  end if;

  -- A real (typed) number: preserve it. Validate only when it is new or changed.
  if new.admission_number is not null then
    if tg_op = 'INSERT' or new.admission_number is distinct from old.admission_number then
      perform pg_advisory_xact_lock(hashtext(new.school_id::text));

      select s.admission_number into v_clash
        from public.students s
        where s.school_id = new.school_id
          and s.id <> new.id
          and lower(s.admission_number) = lower(new.admission_number)
          and s.admission_number <> new.admission_number
        limit 1;
      if v_clash is not null then
        raise exception 'Admission number "%" conflicts with existing number "%" in this school (they differ only by letter case).',
          new.admission_number, v_clash
          using errcode = '23505';
      end if;
    end if;
    return new;
  end if;

  -- Blank: stay NULL until the student is actually enrolling (unchanged behaviour).
  if new.status not in ('enrolled', 'active') then
    return new;
  end if;

  perform pg_advisory_xact_lock(hashtext(new.school_id::text));

  select coalesce(max(admission_number::int), 0) + 1
    into v_next
    from public.students
    where school_id = new.school_id
      and admission_number ~ '^[0-9]{1,9}$';

  new.admission_number := lpad(v_next::text, 3, '0');
  return new;
end;
$$;

comment on function public.assign_admission_number is
  'BEFORE INSERT/UPDATE trigger. A typed admission number is preserved (trimmed) and serialized per school with a case-insensitive clash check; a blank number is auto-assigned (max 1-9 digit numeric + 1, zero-padded to 3+, per-school advisory lock) only when the student becomes enrolled/active. Never regenerates or clears an existing number.';

-- Also validate when only admission_number changes (e.g. correcting a typo before enrolment),
-- not just on status changes. Same function; the status-change trigger is left as is.
drop trigger if exists trg_assign_admission_number_on_number_change on public.students;
create trigger trg_assign_admission_number_on_number_change
  before update of admission_number on public.students
  for each row
  when (new.admission_number is distinct from old.admission_number)
  execute function public.assign_admission_number();

-- Preview shown in the wizard ("Automatic" option). Same logic as the trigger, same overflow guard.
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
      and admission_number ~ '^[0-9]{1,9}$';

  return lpad(v_next::text, 3, '0');
end;
$$;
