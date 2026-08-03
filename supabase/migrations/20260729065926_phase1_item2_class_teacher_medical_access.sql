
create or replace function auth_user_is_class_teacher_of(p_student_id uuid)
returns boolean
language sql
stable
security definer
set search_path to 'public'
as $$
  select exists (
    select 1
    from students s
    join streams st on st.id = s.current_class_id
    join school_users su on su.id = st.class_teacher_id
    where s.id = p_student_id
      and su.auth_user_id = auth.uid()
      and su.status = 'active'
  );
$$;
revoke all on function auth_user_is_class_teacher_of(uuid) from public;
grant execute on function auth_user_is_class_teacher_of(uuid) to authenticated;

drop policy medical_records_select on medical_records;
create policy medical_records_select on medical_records for select
  using (
    auth_is_super_admin()
    or exists (
      select 1 from students s
      where s.id = medical_records.student_id
        and s.school_id = auth_school_id()
        and auth_has_permission('students.medical.read')
    )
    or auth_user_id_is_guardian_of(student_id)
    or auth_user_is_class_teacher_of(student_id)
  );
