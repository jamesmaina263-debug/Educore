
create or replace function auth_user_is_class_teacher_of_stream(p_stream_id uuid)
returns boolean
language sql
stable
security definer
set search_path to 'public'
as $$
  select exists (
    select 1
    from streams st
    join school_users su on su.id = st.class_teacher_id
    where st.id = p_stream_id
      and su.auth_user_id = auth.uid()
      and su.status = 'active'
  );
$$;
revoke all on function auth_user_is_class_teacher_of_stream(uuid) from public;
revoke execute on function auth_user_is_class_teacher_of_stream(uuid) from anon;
grant execute on function auth_user_is_class_teacher_of_stream(uuid) to authenticated;

-- attendance.mark: the class teacher marks their OWN stream's register
-- attendance.mark_any: principal/deputy can mark or correct on behalf of any class in the school
insert into role_permissions (role_id, permission_key, allowed)
select id, 'attendance.mark', true from roles where name = 'class_teacher';
insert into role_permissions (role_id, permission_key, allowed)
select id, 'attendance.mark_any', true from roles where name in ('principal','deputy_principal','school_owner');
insert into role_permissions (role_id, permission_key, allowed)
select id, 'attendance.read', true from roles where name in ('teacher','class_teacher','deputy_principal','principal','school_owner');

create policy student_attendance_select on student_attendance for select
  using (
    auth_is_super_admin()
    or (school_id = auth_school_id() and auth_has_permission('attendance.read'))
    or auth_user_id_is_guardian_of(student_id)
  );

create policy student_attendance_write on student_attendance for all
  using (
    auth_is_super_admin()
    or (school_id = auth_school_id() and auth_has_permission('attendance.mark_any'))
    or (school_id = auth_school_id() and auth_has_permission('attendance.mark') and auth_user_is_class_teacher_of_stream(stream_id))
  )
  with check (
    auth_is_super_admin()
    or (school_id = auth_school_id() and auth_has_permission('attendance.mark_any'))
    or (school_id = auth_school_id() and auth_has_permission('attendance.mark') and auth_user_is_class_teacher_of_stream(stream_id))
  );

-- Editing an already-marked day requires a reason, and every edit is logged.
create or replace function enforce_attendance_edit_reason()
returns trigger
language plpgsql
set search_path to 'public'
as $$
declare
  v_actor uuid;
begin
  if new.status is distinct from old.status then
    if new.edit_reason is null or length(trim(new.edit_reason)) = 0 then
      raise exception 'editing an already-marked attendance record requires a reason';
    end if;

    select su.id into v_actor
    from school_users su
    where su.auth_user_id = auth.uid() and su.status = 'active';

    insert into audit_log (school_id, actor_school_user_id, table_name, record_id, action, reason, old_data, new_data)
    values (
      new.school_id, v_actor, 'student_attendance', new.id, 'update', new.edit_reason,
      jsonb_build_object('status', old.status),
      jsonb_build_object('status', new.status)
    );
  end if;
  return new;
end;
$$;

create trigger trg_student_attendance_edit_reason
  before update on student_attendance
  for each row
  execute function enforce_attendance_edit_reason();
