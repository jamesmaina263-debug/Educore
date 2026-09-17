-- 2026-09-14 production-readiness audit follow-up (part 2, after marks in
-- 20260915051637): `assignment_submissions` had 3 SELECT, 2 INSERT, and 2 UPDATE
-- permissive policies for the same action -- same pure-overhead pattern as
-- marks, same fix: literal OR of the original expressions, copied verbatim
-- from pg_policies, so this changes evaluation cost, not evaluation result.
-- Every subexpression below was copied character-for-character from the live
-- policy definitions (including the `(select auth.uid())` scalar-subquery
-- wrapping already used in the originals -- kept as-is rather than simplified
-- to a bare auth.uid() call, since that wrapping is itself a deliberate
-- per-statement-not-per-row performance pattern already in use here).
-- Both UPDATE policies already had an explicit WITH CHECK identical to their
-- own USING qual, so no default-WITH-CHECK ambiguity to resolve (unlike the
-- marks_approve_own_class case last time).

-- SELECT: assignment_submissions_select_guardian + _select_self + _select_staff
-- -> assignment_submissions_select
drop policy assignment_submissions_select_guardian on public.assignment_submissions;
drop policy assignment_submissions_select_self on public.assignment_submissions;
drop policy assignment_submissions_select_staff on public.assignment_submissions;
create policy assignment_submissions_select on public.assignment_submissions
  for select
  using (
    auth_user_id_is_guardian_of(student_id)
    or exists (
      select 1 from students st
      join school_users su on su.id = st.school_user_id
      where st.id = assignment_submissions.student_id
        and su.auth_user_id = (select auth.uid())
    )
    or exists (
      select 1 from assignments a
      where a.id = assignment_submissions.assignment_id
        and a.school_id = auth_school_id()
        and (
          auth_has_permission('academics.read')
          or a.teacher_id = (select school_users.id from school_users where school_users.auth_user_id = (select auth.uid()))
        )
    )
  );

-- INSERT: assignment_submissions_insert_guardian + _insert_self ->
-- assignment_submissions_insert
drop policy assignment_submissions_insert_guardian on public.assignment_submissions;
drop policy assignment_submissions_insert_self on public.assignment_submissions;
create policy assignment_submissions_insert on public.assignment_submissions
  for insert
  with check (
    (
      auth_user_id_is_guardian_of(student_id)
      and exists (
        select 1 from assignments a
        join students st on st.current_class_id = a.stream_id
        where a.id = assignment_submissions.assignment_id
          and st.id = assignment_submissions.student_id
      )
    )
    or (
      exists (
        select 1 from students st
        join school_users su on su.id = st.school_user_id
        where st.id = assignment_submissions.student_id
          and su.auth_user_id = (select auth.uid())
      )
      and exists (
        select 1 from assignments a
        join students st2 on st2.current_class_id = a.stream_id
        where a.id = assignment_submissions.assignment_id
          and st2.id = assignment_submissions.student_id
      )
    )
  );

-- UPDATE: assignment_submissions_update_grade + _update_own ->
-- assignment_submissions_update
drop policy assignment_submissions_update_grade on public.assignment_submissions;
drop policy assignment_submissions_update_own on public.assignment_submissions;
create policy assignment_submissions_update on public.assignment_submissions
  for update
  using (
    exists (
      select 1 from assignments a
      where a.id = assignment_submissions.assignment_id
        and a.school_id = auth_school_id()
        and (
          auth_has_permission('academics.write')
          or a.teacher_id = (select school_users.id from school_users where school_users.auth_user_id = (select auth.uid()))
        )
    )
    or (
      status = 'submitted'
      and (
        auth_user_id_is_guardian_of(student_id)
        or exists (
          select 1 from students st
          join school_users su on su.id = st.school_user_id
          where st.id = assignment_submissions.student_id
            and su.auth_user_id = (select auth.uid())
        )
      )
    )
  )
  with check (
    exists (
      select 1 from assignments a
      where a.id = assignment_submissions.assignment_id
        and a.school_id = auth_school_id()
        and (
          auth_has_permission('academics.write')
          or a.teacher_id = (select school_users.id from school_users where school_users.auth_user_id = (select auth.uid()))
        )
    )
    or (
      status = 'submitted'
      and (
        auth_user_id_is_guardian_of(student_id)
        or exists (
          select 1 from students st
          join school_users su on su.id = st.school_user_id
          where st.id = assignment_submissions.student_id
            and su.auth_user_id = (select auth.uid())
        )
      )
    )
  );
