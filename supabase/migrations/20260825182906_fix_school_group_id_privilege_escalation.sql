-- CRITICAL: prevent_school_user_privilege_escalation() guards role_id, school_id, status,
-- must_change_password, and temp_password_expires_at against self-editing, but was never
-- updated to guard school_group_id when that column was activated for the group_admin role
-- (20260808080728_multi_campus_group_admin_role_phase5_item1.sql). Since RLS
-- (school_users_update) allows a user to update their own row, and `authenticated` has a
-- raw column-level UPDATE grant on school_group_id, any account holding the group_admin
-- role could set their own school_group_id to a DIFFERENT school group's id and instantly
-- become that group's group_admin -- auth_group_id() reads straight off this column --
-- gaining cross-tenant read access to another school group's schools and financial/
-- enrollment summary. enforce_school_user_scope() doesn't catch this because the row stays
-- internally consistent (group_admin with a non-null school_group_id) regardless of which
-- group it points to.

create or replace function public.prevent_school_user_privilege_escalation()
returns trigger
language plpgsql
set search_path to 'public'
as $function$
declare
  v_caller_is_super_admin boolean;
  v_caller_has_staff_manage boolean;
  v_caller_id uuid := auth.uid();
begin
  if v_caller_id is null then
    -- Service-role (admin) client: no user JWT, already bypasses RLS.
    return new;
  end if;

  select exists (
    select 1 from school_users su join roles r on r.id = su.role_id
    where su.auth_user_id = v_caller_id and su.status = 'active' and r.name = 'super_admin'
  ) into v_caller_is_super_admin;

  if v_caller_is_super_admin then
    return new;
  end if;

  select public.auth_has_permission('staff.manage') into v_caller_has_staff_manage;

  if v_caller_has_staff_manage then
    return new;
  end if;

  if new.role_id is distinct from old.role_id
     or new.school_id is distinct from old.school_id
     or new.school_group_id is distinct from old.school_group_id
     or new.status is distinct from old.status
     or new.must_change_password is distinct from old.must_change_password
     or new.temp_password_expires_at is distinct from old.temp_password_expires_at then
    raise exception 'insufficient privileges to change role_id, school_id, school_group_id, status, or password-gating fields';
  end if;

  return new;
end;
$function$;
