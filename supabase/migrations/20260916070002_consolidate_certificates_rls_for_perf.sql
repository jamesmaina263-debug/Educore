-- Part 8 of the RLS consolidation series. certificates had 3 SELECT-only
-- permissive policies; other actions already had exactly one policy each.
-- Literal OR, copied verbatim. Applied directly to production via Supabase
-- MCP during the audit and verified live.
drop policy certificates_select_guardian on public.certificates;
drop policy certificates_select_self on public.certificates;
drop policy certificates_select_staff on public.certificates;
create policy certificates_select on public.certificates
  for select
  using (
    auth_user_id_is_guardian_of(student_id)
    or exists (
      select 1 from students st
      join school_users su on su.id = st.school_user_id
      where st.id = certificates.student_id
        and su.auth_user_id = (select auth.uid())
    )
    or (school_id = auth_school_id() and auth_has_permission('students.read'))
  );
