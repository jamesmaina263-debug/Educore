
-- Permission keys: one read/write pair governs the whole "Academic Setup" module,
-- matching the blueprint's UI decision to treat Years/Terms/Classes/Streams/Subjects/Timetable
-- as one configuration area rather than six separately-permissioned pages.
insert into role_permissions (role_id, permission_key, allowed)
select id, 'academics.read', true from roles where name in ('school_owner','principal','deputy_principal','teacher','class_teacher','bursar');
insert into role_permissions (role_id, permission_key, allowed)
select id, 'academics.write', true from roles where name in ('school_owner','principal','deputy_principal');

-- academic_years
create policy academic_years_select on academic_years for select
  using (auth_is_super_admin() or (school_id = auth_school_id() and auth_has_permission('academics.read')));
create policy academic_years_write on academic_years for all
  using (auth_is_super_admin() or (school_id = auth_school_id() and auth_has_permission('academics.write')))
  with check (auth_is_super_admin() or (school_id = auth_school_id() and auth_has_permission('academics.write')));

-- terms
create policy terms_select on terms for select
  using (auth_is_super_admin() or (school_id = auth_school_id() and auth_has_permission('academics.read')));
create policy terms_write on terms for all
  using (auth_is_super_admin() or (school_id = auth_school_id() and auth_has_permission('academics.write')))
  with check (auth_is_super_admin() or (school_id = auth_school_id() and auth_has_permission('academics.write')));

-- classes
create policy classes_select on classes for select
  using (auth_is_super_admin() or (school_id = auth_school_id() and auth_has_permission('academics.read')));
create policy classes_write on classes for all
  using (auth_is_super_admin() or (school_id = auth_school_id() and auth_has_permission('academics.write')))
  with check (auth_is_super_admin() or (school_id = auth_school_id() and auth_has_permission('academics.write')));

-- streams
create policy streams_select on streams for select
  using (auth_is_super_admin() or (school_id = auth_school_id() and auth_has_permission('academics.read')));
create policy streams_write on streams for all
  using (auth_is_super_admin() or (school_id = auth_school_id() and auth_has_permission('academics.write')))
  with check (auth_is_super_admin() or (school_id = auth_school_id() and auth_has_permission('academics.write')));

-- subjects
create policy subjects_select on subjects for select
  using (auth_is_super_admin() or (school_id = auth_school_id() and auth_has_permission('academics.read')));
create policy subjects_write on subjects for all
  using (auth_is_super_admin() or (school_id = auth_school_id() and auth_has_permission('academics.write')))
  with check (auth_is_super_admin() or (school_id = auth_school_id() and auth_has_permission('academics.write')));

-- class_subjects
create policy class_subjects_select on class_subjects for select
  using (auth_is_super_admin() or (school_id = auth_school_id() and auth_has_permission('academics.read')));
create policy class_subjects_write on class_subjects for all
  using (auth_is_super_admin() or (school_id = auth_school_id() and auth_has_permission('academics.write')))
  with check (auth_is_super_admin() or (school_id = auth_school_id() and auth_has_permission('academics.write')));

-- timetable_slots (schema+RLS now, UI deferred)
create policy timetable_slots_select on timetable_slots for select
  using (auth_is_super_admin() or (school_id = auth_school_id() and auth_has_permission('academics.read')));
create policy timetable_slots_write on timetable_slots for all
  using (auth_is_super_admin() or (school_id = auth_school_id() and auth_has_permission('academics.write')))
  with check (auth_is_super_admin() or (school_id = auth_school_id() and auth_has_permission('academics.write')));
