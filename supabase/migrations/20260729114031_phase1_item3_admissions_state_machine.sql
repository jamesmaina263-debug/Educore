
alter table students add column status_changed_at timestamptz not null default now();

create or replace function enforce_student_status_transition()
returns trigger
language plpgsql
as $$
begin
  if new.status is distinct from old.status then
    if not (
      (old.status = 'applied'     and new.status in ('approved','withdrawn')) or
      (old.status = 'approved'    and new.status in ('enrolled','withdrawn')) or
      (old.status = 'enrolled'    and new.status in ('active','withdrawn','transferred')) or
      (old.status = 'active'      and new.status in ('withdrawn','transferred','graduated'))
    ) then
      raise exception 'invalid student status transition: % -> %', old.status, new.status;
    end if;

    new.status_changed_at := now();

    -- leaving the active roster: student no longer belongs to a current teaching unit
    if new.status in ('withdrawn','transferred','graduated') then
      new.current_class_id := null;
    end if;
  end if;
  return new;
end;
$$;

create trigger trg_students_enforce_status_transition
  before update on students
  for each row
  execute function enforce_student_status_transition();
