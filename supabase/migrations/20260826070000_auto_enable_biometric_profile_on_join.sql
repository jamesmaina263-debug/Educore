-- Auto-enable biometric enrollment eligibility the moment a student or staff
-- member actually joins the school, instead of requiring someone to open
-- their profile and click "Enable biometric enrollment" (BiometricTab's
-- enableProfile()) by hand for every single person.
--
-- "Joins" is deliberately defined the same way the rest of the codebase
-- already defines it, not reinvented here:
--   - students: status first becomes 'enrolled' or 'active' -- the exact
--     transition assign_admission_number() (20260822100723) and
--     complete_enrollment() key off, guarded by the same
--     enforce_student_status_transition() state machine
--     (applied -> approved -> enrolled -> active). A student created
--     mid-admission (status 'applied'/'approved') is NOT auto-enabled --
--     they haven't joined yet, same reasoning as admission_number staying
--     null until then.
--   - staff: a school_users row is 'active' AND its role is not one of
--     parent/student/super_admin -- the exact filter the Staff list page
--     itself already uses (src/app/(app)/staff/page.tsx) to distinguish
--     "staff" from the parent/student portal accounts that also live in
--     school_users.
--
-- This only ever creates the biometric_profiles row (status = 'active',
-- created_by = null to mark it as system-created rather than a human
-- clicking "Enable" -- distinguishable from a manually-enabled profile
-- without adding a new column). It never creates a biometric_credentials
-- row -- an actual fingerprint/face still has to be enrolled on a device
-- and linked, same as today. It also never re-enables or touches a
-- profile someone has since manually set to 'inactive': the unique
-- (school_id, person_type, person_id) constraint plus ON CONFLICT DO
-- NOTHING makes this purely additive and idempotent, safe to fire on
-- every status update, not just the first one.
--
-- security definer: the person performing the admission/staff-onboarding
-- action (an admissions officer, HR, etc.) very often does NOT hold
-- biometric.enroll themselves, and biometric_profiles' own insert policy
-- requires it. Same reasoning assign_admission_number() already relies on.

create or replace function public.auto_enable_student_biometric_profile()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $$
begin
  if new.status = any (array['enrolled', 'active']) then
    insert into public.biometric_profiles (school_id, person_type, person_id, status, created_by)
    values (new.school_id, 'student', new.id, 'active', null)
    on conflict (school_id, person_type, person_id) do nothing;
  end if;
  return new;
end;
$$;

comment on function public.auto_enable_student_biometric_profile is
  'AFTER INSERT/UPDATE trigger on students: auto-creates an active biometric_profiles row the moment a student''s status first becomes enrolled/active, so every enrolled student is eligible for biometric enrollment without a manual "Enable" step. Idempotent (ON CONFLICT DO NOTHING) and additive-only -- never touches a profile a human has since deactivated.';

drop trigger if exists trg_auto_enable_student_biometric_profile on public.students;
create trigger trg_auto_enable_student_biometric_profile
  after insert or update of status on public.students
  for each row
  execute function public.auto_enable_student_biometric_profile();

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
  -- cross-school super_admin role, none of which are "staff".
  if v_role_name = any (array['parent', 'student', 'super_admin']) then
    return new;
  end if;

  insert into public.biometric_profiles (school_id, person_type, person_id, status, created_by)
  values (new.school_id, 'staff', new.id, 'active', null)
  on conflict (school_id, person_type, person_id) do nothing;

  return new;
end;
$$;

comment on function public.auto_enable_staff_biometric_profile is
  'AFTER INSERT/UPDATE trigger on school_users: auto-creates an active biometric_profiles row the moment a staff account (any role except parent/student/super_admin) is active, so every staff member is eligible for biometric enrollment without a manual "Enable" step. Idempotent (ON CONFLICT DO NOTHING) and additive-only -- never touches a profile a human has since deactivated.';

drop trigger if exists trg_auto_enable_staff_biometric_profile on public.school_users;
create trigger trg_auto_enable_staff_biometric_profile
  after insert or update of status, role_id on public.school_users
  for each row
  execute function public.auto_enable_staff_biometric_profile();
