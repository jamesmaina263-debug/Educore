-- CRITICAL: a user holding staff.manage (every school's principal, deputy_principal and
-- school_owner) could move their own school_users row into ANY other school by changing
-- school_id, and keep their role there.
--
-- Cause: school_users_update lets a user update their own row (auth_user_id = auth.uid())
-- and never constrains school_id in USING or WITH CHECK. The only guard,
-- prevent_school_user_privilege_escalation(), returned early for any staff.manage holder
-- before checking school_id / school_group_id. enforce_school_user_scope() only checks
-- that school_id is non-null. Roles are global, so "principal" in school A is the same
-- role row as "principal" in school B.
--
-- Fix: after the super_admin early-return, moving a user between schools or groups is a
-- platform-level action and is refused for everyone else. Service-role calls
-- (auth.uid() is null) still return first, so invite / reset / admin flows are unchanged.
-- No existing app path moves school_id as a normal user (checked src/ and every
-- SECURITY DEFINER function in public).
--
-- Body is the currently deployed function plus the new block, nothing else changed.

create or replace function public.prevent_school_user_privilege_escalation()
returns trigger
language plpgsql
set search_path to 'public'
as $function$
declare
  v_caller_is_super_admin boolean;
  v_caller_has_staff_manage boolean;
  v_caller_id uuid := auth.uid();
  v_old_role_name text;
  v_new_role_name text;
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

  -- NEW: tenant membership can only be changed by a platform super_admin.
  if new.school_id is distinct from old.school_id
     or new.school_group_id is distinct from old.school_group_id then
    raise exception 'only a platform super_admin can move a user between schools or groups';
  end if;

  -- Assigning (or removing) the super_admin/group_admin roles crosses the single-school
  -- tenant boundary and always requires an existing super_admin, regardless of staff.manage.
  if new.role_id is distinct from old.role_id then
    select name into v_old_role_name from roles where id = old.role_id;
    select name into v_new_role_name from roles where id = new.role_id;
    if v_old_role_name in ('super_admin', 'group_admin') or v_new_role_name in ('super_admin', 'group_admin') then
      raise exception 'insufficient privileges to assign or remove the super_admin/group_admin role';
    end if;
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
