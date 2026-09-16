-- Part 10 of the RLS consolidation series. discipline_records had 3
-- SELECT-only permissive policies; other actions already had exactly one
-- policy each. Literal OR, copied verbatim. Applied directly to production
-- via Supabase MCP during the audit and verified live.
drop policy discipline_records_select_guardian on public.discipline_records;
drop policy discipline_records_select_self on public.discipline_records;
drop policy discipline_records_select_staff on public.discipline_records;
create policy discipline_records_select on public.discipline_records
  for select
  using (
    (auth_user_id_is_guardian_of(student_id) and visible_to_guardian = true)
    or (
      visible_to_guardian = true
      and exists (
        select 1 from students st
        join school_users su on su.id = st.school_user_id
        where st.id = discipline_records.student_id
          and su.auth_user_id = (select auth.uid())
      )
    )
    or (
      school_id = auth_school_id()
      and (
        auth_has_permission('discipline.read_any')
        or recorded_by = (select school_users.id from school_users where school_users.auth_user_id = (select auth.uid()))
      )
    )
  );
