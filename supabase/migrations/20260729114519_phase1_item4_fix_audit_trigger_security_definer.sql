
create or replace function enforce_attendance_edit_reason()
returns trigger
language plpgsql
security definer
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
revoke all on function enforce_attendance_edit_reason() from public;
revoke execute on function enforce_attendance_edit_reason() from anon, authenticated;
