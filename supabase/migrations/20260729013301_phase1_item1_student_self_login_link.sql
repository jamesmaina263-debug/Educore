-- A student old enough to have their own login (Student Portal, role =
-- 'student') needs their students row linked to their school_users row --
-- nullable, since most students (especially younger ones) won't have
-- their own login and are only ever viewed through a guardian.
alter table students add column school_user_id uuid references school_users(id) on delete set null;
create unique index uq_students_school_user_id on students(school_user_id) where school_user_id is not null;

create or replace function enforce_student_login_link_validity()
returns trigger
language plpgsql
set search_path = public
as $$
declare
  v_role_name text;
  v_linked_school_id uuid;
begin
  if new.school_user_id is null then
    return new;
  end if;

  select r.name, su.school_id into v_role_name, v_linked_school_id
  from school_users su join roles r on r.id = su.role_id
  where su.id = new.school_user_id;

  if v_role_name <> 'student' then
    raise exception 'school_user_id must reference a school_users row with role = student';
  end if;

  if v_linked_school_id is distinct from new.school_id then
    raise exception 'linked school_users row must belong to the same school as the student';
  end if;

  return new;
end;
$$;

create trigger trg_students_enforce_login_link
  before insert or update on students
  for each row execute function enforce_student_login_link_validity();
