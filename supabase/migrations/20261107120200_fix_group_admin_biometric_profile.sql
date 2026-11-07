-- Fix: creating an ACTIVE group_admin account fails with "person_id ... is not a staff member of school <NULL>".
--
-- Cause: trg_auto_enable_staff_biometric_profile (20260826060631) auto-creates a biometric staff profile for every active school_users row
-- except the roles parent, student and super_admin. A group_admin has school_id NULL (it spans a group), so the profile insert is
-- rejected by validate_biometric_profile_person() and the whole insert of the account fails. Found by the WP 3.4 test fixtures; production
-- has zero group_admin accounts, which fits (none could be created while active).
--
-- Change: the same function with 'group_admin' added to the roles that get no biometric profile (there is no school to enrol them at).
-- Nothing else changes: the same trigger, the same behaviour for every other role. Only rows that currently raise an error are affected.

create or replace function public.auto_enable_staff_biometric_profile()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_role_name text;
begin
  if new.status <> 'active' then
    return new;
  end if;

  select r.name into v_role_name from public.roles r where r.id = new.role_id;

  -- Same staff-vs-portal-account filter the Staff list page already uses:
  -- school_users also holds parent and student portal logins, and the
  -- cross-school super_admin and group_admin roles, none of which are "staff" of one school.
  if v_role_name = any (array['parent', 'student', 'super_admin', 'group_admin']) then
    return new;
  end if;

  insert into public.biometric_profiles (school_id, person_type, person_id, status, created_by)
  values (new.school_id, 'staff', new.id, 'active', null)
  on conflict (school_id, person_type, person_id) do nothing;

  return new;
end;
$$;
