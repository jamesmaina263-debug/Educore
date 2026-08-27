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

  new.admission_number := v_next::text;
  return new;
end;
$$;

comment on function public.assign_admission_number is
  'BEFORE INSERT/UPDATE trigger: fills students.admission_number automatically (max numeric admission_number for the school + 1, per-school advisory-locked to stay race-safe) the moment a student''s status first becomes enrolled/active -- not at row creation. A student created mid-admission (status applied/approved) has its admission_number normalized to null until Complete Enrollment actually runs, so abandoned/draft admissions never burn a real sequential number and never collide with each other on the (school_id, admission_number) unique constraint.';
