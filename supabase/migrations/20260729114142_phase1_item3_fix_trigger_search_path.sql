
create or replace function enforce_student_status_transition()
returns trigger
language plpgsql
set search_path to 'public'
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

    if new.status in ('withdrawn','transferred','graduated') then
      new.current_class_id := null;
    end if;
  end if;
  return new;
end;
$$;
