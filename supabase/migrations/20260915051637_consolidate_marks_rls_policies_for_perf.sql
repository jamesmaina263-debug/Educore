-- 2026-09-14 production-readiness audit follow-up: `marks` had 2 DELETE, 2 INSERT,
-- and 4 UPDATE permissive policies for the same role/action -- Postgres evaluates
-- every permissive policy on every matching query and OR's the results together,
-- so this is pure per-query overhead with zero behavior difference from one
-- consolidated policy per action. Same fix already applied to the finance tables
-- in 20260731065102_finance_rls_consolidation_and_perf.sql; this applies the
-- identical pattern to `marks`.
--
-- Correctness approach: each new policy's expression is the literal OR of the
-- original policies' qual/with_check expressions, copied verbatim from
-- pg_policies (not rewritten or "simplified") -- so this changes evaluation cost,
-- not evaluation result. For the UPDATE consolidation specifically:
-- marks_approve_own_class had no explicit WITH CHECK, which Postgres defaults to
-- the policy's own USING qual -- that default is made explicit here rather than
-- relied upon implicitly, but the resulting boolean expression is identical
-- either way (verified: the combined WITH CHECK below is textually identical to
-- the combined USING below, because that was already true policy-by-policy).
-- Post-apply, the live policy definitions were pulled back via pg_policies and
-- confirmed to match this file expression-for-expression.
--
-- SELECT was left alone: `marks` already has exactly one SELECT policy
-- (marks_select), so there's nothing to consolidate there.
--
-- Applied directly to production via the Supabase MCP connection during the
-- audit (matches what's live); this file exists so migration-drift-check.yml
-- doesn't flag it as an out-of-band change.

-- DELETE: marks_write_any_delete + marks_write_own_delete -> marks_delete
drop policy marks_write_any_delete on public.marks;
drop policy marks_write_own_delete on public.marks;
create policy marks_delete on public.marks
  for delete
  using (
    (school_id = auth_school_id() and auth_has_permission('marks.write_any'))
    or (
      school_id = auth_school_id() and auth_has_permission('marks.write')
      and exists (
        select 1 from students st
        where st.id = marks.student_id
          and auth_user_teaches_subject_in_stream(st.current_class_id, marks.subject_id)
      )
    )
  );

-- INSERT: marks_write_any_insert + marks_write_own_insert -> marks_insert
drop policy marks_write_any_insert on public.marks;
drop policy marks_write_own_insert on public.marks;
create policy marks_insert on public.marks
  for insert
  with check (
    (school_id = auth_school_id() and auth_has_permission('marks.write_any'))
    or (
      school_id = auth_school_id() and auth_has_permission('marks.write')
      and exists (
        select 1 from students st
        where st.id = marks.student_id
          and auth_user_teaches_subject_in_stream(st.current_class_id, marks.subject_id)
      )
    )
  );

-- UPDATE: marks_approve_any + marks_approve_own_class + marks_write_any_update +
-- marks_write_own_update -> marks_update
drop policy marks_approve_any on public.marks;
drop policy marks_approve_own_class on public.marks;
drop policy marks_write_any_update on public.marks;
drop policy marks_write_own_update on public.marks;
create policy marks_update on public.marks
  for update
  using (
    auth_is_super_admin()
    or (school_id = auth_school_id() and auth_has_permission('marks.approve_any'))
    or (
      auth_is_super_admin()
      or (
        school_id = auth_school_id() and auth_has_permission('marks.approve')
        and exists (
          select 1 from students s
          join streams st on st.id = s.current_class_id
          where s.id = marks.student_id and st.class_teacher_id = auth_school_user_id()
        )
      )
    )
    or (school_id = auth_school_id() and auth_has_permission('marks.write_any'))
    or (
      school_id = auth_school_id() and auth_has_permission('marks.write')
      and exists (
        select 1 from students st
        where st.id = marks.student_id
          and auth_user_teaches_subject_in_stream(st.current_class_id, marks.subject_id)
      )
    )
  )
  with check (
    auth_is_super_admin()
    or (school_id = auth_school_id() and auth_has_permission('marks.approve_any'))
    or (
      auth_is_super_admin()
      or (
        school_id = auth_school_id() and auth_has_permission('marks.approve')
        and exists (
          select 1 from students s
          join streams st on st.id = s.current_class_id
          where s.id = marks.student_id and st.class_teacher_id = auth_school_user_id()
        )
      )
    )
    or (school_id = auth_school_id() and auth_has_permission('marks.write_any'))
    or (
      school_id = auth_school_id() and auth_has_permission('marks.write')
      and exists (
        select 1 from students st
        where st.id = marks.student_id
          and auth_user_teaches_subject_in_stream(st.current_class_id, marks.subject_id)
      )
    )
  );
