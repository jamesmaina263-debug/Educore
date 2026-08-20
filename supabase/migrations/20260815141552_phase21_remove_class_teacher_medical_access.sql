-- Phase 21 regression finding: brief Section 12.1 requires "a teacher must not
-- open confidential medical records." The medical_records, health_emergencies,
-- and sick_bay_visits SELECT policies each had an
-- `OR auth_user_is_class_teacher_of(student_id)` clause granting a student's
-- class teacher blanket read access to the raw table (medical_records includes
-- free-text `conditions`, `allergies`, `notes`) with no permission check on that
-- path. Removes the class-teacher clause from all three. Guardians
-- (auth_user_id_is_guardian_of) and permission-gated staff
-- (students.medical.read / health.read_any) are untouched.
--
-- Applied directly to the live project (alzqlvfaftwegptfbfej) via Supabase MCP
-- on 2026-08-15; this file brings migration history back in sync with that.

drop policy if exists "medical_records_select" on public.medical_records;
create policy "medical_records_select" on public.medical_records
for select
using (
  auth_is_super_admin()
  or (exists (
    select 1 from public.students s
    where s.id = medical_records.student_id
      and s.school_id = auth_school_id()
      and auth_has_permission('students.medical.read')
  ))
  or auth_user_id_is_guardian_of(student_id)
);

drop policy if exists "health_emergencies_select" on public.health_emergencies;
create policy "health_emergencies_select" on public.health_emergencies
for select
using (
  auth_is_super_admin()
  or ((school_id = auth_school_id()) and auth_has_permission('health.read_any'))
  or auth_user_id_is_guardian_of(student_id)
);

drop policy if exists "sick_bay_visits_select" on public.sick_bay_visits;
create policy "sick_bay_visits_select" on public.sick_bay_visits
for select
using (
  auth_is_super_admin()
  or ((school_id = auth_school_id()) and auth_has_permission('health.read_any'))
  or auth_user_id_is_guardian_of(student_id)
);
