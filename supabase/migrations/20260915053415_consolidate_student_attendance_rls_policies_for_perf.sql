-- 2026-09-14 audit follow-up: student_attendance had a FOR ALL policy
-- (student_attendance_write) overlapping with a separate SELECT policy and two
-- separate UPDATE (approve) policies. Splitting FOR ALL into per-command
-- policies per documented Postgres RLS semantics: USING applies to
-- SELECT/UPDATE/DELETE, WITH CHECK applies to INSERT/UPDATE. Since
-- student_attendance_write's qual and with_check were already textually
-- identical, the split introduces no behavior change on its own.
--
-- INSERT and DELETE were NOT flagged by the advisor as having multiple
-- policies (only student_attendance_write applied to those actions), so they
-- become single, unmerged policies -- same expression as before, just named
-- and scoped explicitly instead of inherited from FOR ALL.
--
-- SELECT and UPDATE *were* flagged, so those two get the OR-merge, same
-- verbatim-expression approach used for `marks`.

drop policy student_attendance_write on public.student_attendance;
drop policy student_attendance_select on public.student_attendance;
drop policy student_attendance_approve_any on public.student_attendance;
drop policy student_attendance_approve_own_class on public.student_attendance;

-- SELECT: (former ALL qual) OR (former select qual)
create policy student_attendance_select on public.student_attendance
  for select
  using (
    (
      auth_is_super_admin()
      or (school_id = auth_school_id() and auth_has_permission('attendance.mark_any'))
      or (school_id = auth_school_id() and auth_has_permission('attendance.mark') and auth_user_is_class_teacher_of_stream(stream_id))
    )
    or (
      auth_is_super_admin()
      or (school_id = auth_school_id() and auth_has_permission('attendance.read'))
      or auth_user_id_is_guardian_of(student_id)
      or exists (
        select 1 from students st
        join school_users su on su.id = st.school_user_id
        where st.id = student_attendance.student_id and su.auth_user_id = auth.uid()
      )
    )
  );

-- INSERT: unchanged from former ALL with_check, just named explicitly. No
-- other policy applied to INSERT, so nothing to merge.
create policy student_attendance_insert on public.student_attendance
  for insert
  with check (
    auth_is_super_admin()
    or (school_id = auth_school_id() and auth_has_permission('attendance.mark_any'))
    or (school_id = auth_school_id() and auth_has_permission('attendance.mark') and auth_user_is_class_teacher_of_stream(stream_id))
  );

-- UPDATE: (former ALL qual/check) OR (approve_any) OR (approve_own_class)
create policy student_attendance_update on public.student_attendance
  for update
  using (
    (
      auth_is_super_admin()
      or (school_id = auth_school_id() and auth_has_permission('attendance.mark_any'))
      or (school_id = auth_school_id() and auth_has_permission('attendance.mark') and auth_user_is_class_teacher_of_stream(stream_id))
    )
    or (
      auth_is_super_admin()
      or (school_id = auth_school_id() and auth_has_permission('attendance.approve_correction') and auth_has_permission('attendance.mark_any'))
    )
    or (
      auth_is_super_admin()
      or (
        school_id = auth_school_id() and auth_has_permission('attendance.approve_correction')
        and exists (
          select 1 from streams st
          where st.id = student_attendance.stream_id and st.class_teacher_id = auth_school_user_id()
        )
      )
    )
  )
  with check (
    (
      auth_is_super_admin()
      or (school_id = auth_school_id() and auth_has_permission('attendance.mark_any'))
      or (school_id = auth_school_id() and auth_has_permission('attendance.mark') and auth_user_is_class_teacher_of_stream(stream_id))
    )
    or (
      auth_is_super_admin()
      or (school_id = auth_school_id() and auth_has_permission('attendance.approve_correction') and auth_has_permission('attendance.mark_any'))
    )
    or (
      auth_is_super_admin()
      or (
        school_id = auth_school_id() and auth_has_permission('attendance.approve_correction')
        and exists (
          select 1 from streams st
          where st.id = student_attendance.stream_id and st.class_teacher_id = auth_school_user_id()
        )
      )
    )
  );

-- DELETE: unchanged from former ALL qual, just named explicitly. No other
-- policy applied to DELETE, so nothing to merge.
create policy student_attendance_delete on public.student_attendance
  for delete
  using (
    auth_is_super_admin()
    or (school_id = auth_school_id() and auth_has_permission('attendance.mark_any'))
    or (school_id = auth_school_id() and auth_has_permission('attendance.mark') and auth_user_is_class_teacher_of_stream(stream_id))
  );
