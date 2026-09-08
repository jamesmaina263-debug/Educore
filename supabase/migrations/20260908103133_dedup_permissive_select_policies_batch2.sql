-- Perf fix (advisor: multiple_permissive_policies): these 5 tables each had a
-- "_select" policy (FOR SELECT) and a "_write" policy (FOR ALL, which implicitly
-- includes SELECT), so every SELECT evaluated both quals. Verified via
-- role_permissions + user_permission_overrides that zero active users currently
-- hold the write permission without the paired read permission for any of:
-- academics.write/read, staff.manage/staff.read, students.documents.write/read,
-- admissions.write/read_any — so narrowing "_write" off SELECT changes no one's
-- actual access today. The richer guardian/student/self read branches already
-- living in "_select" for documents, staff_qualifications, classes, streams,
-- timetable_slots are untouched.

-- classes
drop policy if exists classes_write on public.classes;
create policy classes_insert on public.classes for insert
  with check (auth_is_super_admin() or ((school_id = auth_school_id()) and auth_has_permission('academics.write')));
create policy classes_update on public.classes for update
  using (auth_is_super_admin() or ((school_id = auth_school_id()) and auth_has_permission('academics.write')))
  with check (auth_is_super_admin() or ((school_id = auth_school_id()) and auth_has_permission('academics.write')));
create policy classes_delete on public.classes for delete
  using (auth_is_super_admin() or ((school_id = auth_school_id()) and auth_has_permission('academics.write')));

-- streams
drop policy if exists streams_write on public.streams;
create policy streams_insert on public.streams for insert
  with check (auth_is_super_admin() or ((school_id = auth_school_id()) and auth_has_permission('academics.write')));
create policy streams_update on public.streams for update
  using (auth_is_super_admin() or ((school_id = auth_school_id()) and auth_has_permission('academics.write')))
  with check (auth_is_super_admin() or ((school_id = auth_school_id()) and auth_has_permission('academics.write')));
create policy streams_delete on public.streams for delete
  using (auth_is_super_admin() or ((school_id = auth_school_id()) and auth_has_permission('academics.write')));

-- timetable_slots
drop policy if exists timetable_slots_write on public.timetable_slots;
create policy timetable_slots_insert on public.timetable_slots for insert
  with check (auth_is_super_admin() or ((school_id = auth_school_id()) and auth_has_permission('academics.write')));
create policy timetable_slots_update on public.timetable_slots for update
  using (auth_is_super_admin() or ((school_id = auth_school_id()) and auth_has_permission('academics.write')))
  with check (auth_is_super_admin() or ((school_id = auth_school_id()) and auth_has_permission('academics.write')));
create policy timetable_slots_delete on public.timetable_slots for delete
  using (auth_is_super_admin() or ((school_id = auth_school_id()) and auth_has_permission('academics.write')));

-- staff_qualifications
drop policy if exists staff_qualifications_write on public.staff_qualifications;
create policy staff_qualifications_insert on public.staff_qualifications for insert
  with check (auth_is_super_admin() or ((school_id = auth_school_id()) and auth_has_permission('staff.manage')));
create policy staff_qualifications_update on public.staff_qualifications for update
  using (auth_is_super_admin() or ((school_id = auth_school_id()) and auth_has_permission('staff.manage')))
  with check (auth_is_super_admin() or ((school_id = auth_school_id()) and auth_has_permission('staff.manage')));
create policy staff_qualifications_delete on public.staff_qualifications for delete
  using (auth_is_super_admin() or ((school_id = auth_school_id()) and auth_has_permission('staff.manage')));

-- documents (3-way branch: student docs / staff docs / application docs)
drop policy if exists documents_write on public.documents;
create policy documents_insert on public.documents for insert
  with check (
    auth_is_super_admin()
    or ((school_id = auth_school_id()) and (student_id is not null) and auth_has_permission('students.documents.write'))
    or ((school_id = auth_school_id()) and (staff_id is not null) and auth_has_permission('staff.manage'))
    or ((school_id = auth_school_id()) and (application_id is not null) and auth_has_permission('admissions.write'))
  );
create policy documents_update on public.documents for update
  using (
    auth_is_super_admin()
    or ((school_id = auth_school_id()) and (student_id is not null) and auth_has_permission('students.documents.write'))
    or ((school_id = auth_school_id()) and (staff_id is not null) and auth_has_permission('staff.manage'))
    or ((school_id = auth_school_id()) and (application_id is not null) and auth_has_permission('admissions.write'))
  )
  with check (
    auth_is_super_admin()
    or ((school_id = auth_school_id()) and (student_id is not null) and auth_has_permission('students.documents.write'))
    or ((school_id = auth_school_id()) and (staff_id is not null) and auth_has_permission('staff.manage'))
    or ((school_id = auth_school_id()) and (application_id is not null) and auth_has_permission('admissions.write'))
  );
create policy documents_delete on public.documents for delete
  using (
    auth_is_super_admin()
    or ((school_id = auth_school_id()) and (student_id is not null) and auth_has_permission('students.documents.write'))
    or ((school_id = auth_school_id()) and (staff_id is not null) and auth_has_permission('staff.manage'))
    or ((school_id = auth_school_id()) and (application_id is not null) and auth_has_permission('admissions.write'))
  );
