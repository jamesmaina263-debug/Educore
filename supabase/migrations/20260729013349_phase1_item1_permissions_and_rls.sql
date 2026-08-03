insert into role_permissions (role_id, permission_key, allowed)
select id, 'students.read', true from roles where name in ('school_owner', 'principal', 'deputy_principal', 'teacher', 'class_teacher')
union all
select id, 'students.write', true from roles where name in ('school_owner', 'principal', 'deputy_principal')
union all
select id, 'students.medical.read', true from roles where name in ('school_owner', 'principal')
union all
select id, 'students.medical.write', true from roles where name in ('school_owner', 'principal')
union all
select id, 'students.documents.read', true from roles where name in ('school_owner', 'principal', 'deputy_principal')
union all
select id, 'students.documents.write', true from roles where name in ('school_owner', 'principal', 'deputy_principal');

alter table students enable row level security;
alter table student_guardians enable row level security;
alter table medical_records enable row level security;
alter table documents enable row level security;
alter table document_access_log enable row level security;

create policy students_select on students
  for select
  using (
    auth_is_super_admin()
    or (school_id = auth_school_id() and auth_has_permission('students.read'))
    or auth_user_id_is_guardian_of(id)
    or school_user_id = (select id from school_users where auth_user_id = auth.uid() and status = 'active')
  );

create policy students_insert on students
  for insert
  with check (auth_is_super_admin() or (school_id = auth_school_id() and auth_has_permission('students.write')));

create policy students_update on students
  for update
  using (auth_is_super_admin() or (school_id = auth_school_id() and auth_has_permission('students.write')))
  with check (auth_is_super_admin() or (school_id = auth_school_id() and auth_has_permission('students.write')));

create policy student_guardians_select on student_guardians
  for select
  using (
    auth_is_super_admin()
    or exists (
      select 1 from students s
      where s.id = student_guardians.student_id
        and s.school_id = auth_school_id()
        and auth_has_permission('students.read')
    )
    or guardian_user_id = (select id from school_users where auth_user_id = auth.uid() and status = 'active')
  );

create policy student_guardians_write on student_guardians
  for all
  using (
    auth_is_super_admin()
    or exists (
      select 1 from students s
      where s.id = student_guardians.student_id
        and s.school_id = auth_school_id()
        and auth_has_permission('students.write')
    )
  )
  with check (
    auth_is_super_admin()
    or exists (
      select 1 from students s
      where s.id = student_guardians.student_id
        and s.school_id = auth_school_id()
        and auth_has_permission('students.write')
    )
  );

create policy medical_records_select on medical_records
  for select
  using (
    auth_is_super_admin()
    or exists (
      select 1 from students s
      where s.id = medical_records.student_id
        and s.school_id = auth_school_id()
        and auth_has_permission('students.medical.read')
    )
    or auth_user_id_is_guardian_of(student_id)
  );

create policy medical_records_write on medical_records
  for all
  using (
    auth_is_super_admin()
    or exists (
      select 1 from students s
      where s.id = medical_records.student_id
        and s.school_id = auth_school_id()
        and auth_has_permission('students.medical.write')
    )
  )
  with check (
    auth_is_super_admin()
    or exists (
      select 1 from students s
      where s.id = medical_records.student_id
        and s.school_id = auth_school_id()
        and auth_has_permission('students.medical.write')
    )
  );

create policy documents_select on documents
  for select
  using (
    auth_is_super_admin()
    or (school_id = auth_school_id() and auth_has_permission('students.documents.read'))
    or auth_user_id_is_guardian_of(student_id)
  );

create policy documents_write on documents
  for all
  using (auth_is_super_admin() or (school_id = auth_school_id() and auth_has_permission('students.documents.write')))
  with check (auth_is_super_admin() or (school_id = auth_school_id() and auth_has_permission('students.documents.write')));

create policy document_access_log_select on document_access_log
  for select
  using (
    auth_is_super_admin()
    or (school_id = auth_school_id() and auth_has_permission('students.medical.read'))
  );
