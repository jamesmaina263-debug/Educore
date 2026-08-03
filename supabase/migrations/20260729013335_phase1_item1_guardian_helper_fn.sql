create or replace function auth_user_id_is_guardian_of(p_student_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from student_guardians sg
    join school_users su on su.id = sg.guardian_user_id
    where sg.student_id = p_student_id
      and su.auth_user_id = auth.uid()
      and su.status = 'active'
  );
$$;

revoke execute on function auth_user_id_is_guardian_of(uuid) from public, anon;
grant execute on function auth_user_id_is_guardian_of(uuid) to authenticated;
