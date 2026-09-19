-- Part 7 of the RLS consolidation series. assignments had 3 SELECT-only
-- permissive policies; other actions already had exactly one policy each.
-- Literal OR of the three original quals, copied verbatim. Applied directly
-- to production via Supabase MCP during the audit and verified live.
drop policy assignments_select_guardian on public.assignments;
drop policy assignments_select_self on public.assignments;
drop policy assignments_select_staff on public.assignments;
create policy assignments_select on public.assignments
  for select
  using (
    exists (
      select 1 from students st
      join student_guardians sg on sg.student_id = st.id
      join school_users su on su.id = sg.guardian_user_id
      where st.current_class_id = assignments.stream_id
        and su.auth_user_id = (select auth.uid())
    )
    or exists (
      select 1 from students st
      join school_users su on su.id = st.school_user_id
      where st.current_class_id = assignments.stream_id
        and su.auth_user_id = (select auth.uid())
    )
    or (school_id = auth_school_id() and auth_has_permission('academics.read'))
  );
