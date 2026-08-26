-- CRITICAL: staff.manage (held by default by every school's own principal,
-- deputy_principal, and school_owner -- ordinary customer-admin roles, not platform
-- operators) was sufficient to grant the platform-wide super_admin role (and the
-- group-crossing group_admin role) to any account, via two independent paths:
--
-- 1. INSERT: school_users_insert's WITH CHECK only required staff.manage + own
--    school_id -- no restriction on role_id at all. inviteStaffMember() (or any direct
--    insert) could create a brand-new staff account with role_id = super_admin from
--    the start.
-- 2. UPDATE: prevent_school_user_privilege_escalation()'s "if v_caller_has_staff_manage
--    then return new" bypassed every column guard unconditionally, including role_id --
--    letting a staff.manage holder promote their own or anyone else's row directly.
--
-- super_admin bypasses auth_school_id() scoping across every table in the schema, so
-- this was a one-call escalation from "one customer's own school admin" to full
-- read/write access to every school on the platform. group_admin is included in the
-- same restriction since it also crosses the single-school tenant boundary (see the
-- school_group_id fix earlier in this audit).
--
-- The app's own UI already never offered these roles in the invite/change-role dropdown
-- (settings/_data.ts explicitly excludes super_admin and group_admin), confirming this
-- was purely a missing server-side enforcement gap, not intentional -- so this closes
-- with zero regression risk.
--
-- Fix: assigning role_id = super_admin or group_admin (via INSERT or UPDATE) now
-- requires the caller to already be a super_admin. staff.manage still works for every
-- ordinary school role.

drop policy if exists school_users_insert on public.school_users;

create policy school_users_insert on public.school_users
  for insert
  with check (
    auth_is_super_admin()
    or (
      school_id = auth_school_id()
      and auth_has_permission('staff.manage')
      and role_id not in (select id from roles where name in ('super_admin', 'group_admin'))
    )
  );

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
