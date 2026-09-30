-- Part 9 of the RLS consolidation series. disciplinary_actions had 3
-- SELECT-only permissive policies; other actions already had exactly one
-- policy each. Literal OR, copied verbatim. Applied directly to production
-- via Supabase MCP during the audit and verified live.
drop policy disciplinary_actions_select on public.disciplinary_actions;
drop policy disciplinary_actions_select_guardian on public.disciplinary_actions;
drop policy disciplinary_actions_select_self on public.disciplinary_actions;
create policy disciplinary_actions_select on public.disciplinary_actions
  for select
  using (
    (auth_is_super_admin() or (school_id = auth_school_id() and (auth_has_permission('discipline.read_any') or issued_by = auth_school_user_id())))
    or auth_user_id_is_guardian_of(student_id)
    or exists (
      select 1 from students st
      join school_users su on su.id = st.school_user_id
      where st.id = disciplinary_actions.student_id
        and su.auth_user_id = (select auth.uid())
    )
  );
