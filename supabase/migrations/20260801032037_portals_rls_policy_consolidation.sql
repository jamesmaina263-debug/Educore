
-- Consolidate the newly-added guardian/self SELECT policies into the existing staff SELECT policy
-- per table (same fix applied to Finance's tables earlier this phase) — one OR'd policy instead of
-- multiple permissive ones, functionally identical, clears the advisor's multiple_permissive_policies WARN.

drop policy report_cards_select on report_cards;
drop policy report_cards_select_guardian on report_cards;
drop policy report_cards_select_self on report_cards;
create policy report_cards_select on report_cards for select
  using (
    (school_id = auth_school_id() and auth_has_permission('exams.read'))
    or (auth_user_id_is_guardian_of(report_cards.student_id) and comment_source in ('teacher_approved', 'teacher_written'))
    or (
      comment_source in ('teacher_approved', 'teacher_written')
      and exists (select 1 from students st join school_users su on su.id = st.school_user_id where st.id = report_cards.student_id and su.auth_user_id = (select auth.uid()))
    )
  );

drop policy marks_select on marks;
drop policy marks_select_guardian on marks;
drop policy marks_select_self on marks;
create policy marks_select on marks for select
  using (
    (school_id = auth_school_id() and auth_has_permission('exams.read'))
    or (
      auth_user_id_is_guardian_of(marks.student_id)
      and exists (select 1 from report_cards rc where rc.exam_id = marks.exam_id and rc.student_id = marks.student_id and rc.comment_source in ('teacher_approved', 'teacher_written'))
    )
    or (
      exists (select 1 from students st join school_users su on su.id = st.school_user_id where st.id = marks.student_id and su.auth_user_id = (select auth.uid()))
      and exists (select 1 from report_cards rc where rc.exam_id = marks.exam_id and rc.student_id = marks.student_id and rc.comment_source in ('teacher_approved', 'teacher_written'))
    )
  );

drop policy class_rankings_select on class_rankings;
drop policy class_rankings_select_guardian on class_rankings;
drop policy class_rankings_select_self on class_rankings;
create policy class_rankings_select on class_rankings for select
  using (
    exists (select 1 from exams e where e.id = class_rankings.exam_id and e.school_id = auth_school_id() and auth_has_permission('exams.read'))
    or (
      auth_user_id_is_guardian_of(class_rankings.student_id)
      and exists (select 1 from report_cards rc where rc.exam_id = class_rankings.exam_id and rc.student_id = class_rankings.student_id and rc.comment_source in ('teacher_approved', 'teacher_written'))
    )
    or (
      exists (select 1 from students st join school_users su on su.id = st.school_user_id where st.id = class_rankings.student_id and su.auth_user_id = (select auth.uid()))
      and exists (select 1 from report_cards rc where rc.exam_id = class_rankings.exam_id and rc.student_id = class_rankings.student_id and rc.comment_source in ('teacher_approved', 'teacher_written'))
    )
  );

drop policy student_attendance_select on student_attendance;
drop policy student_attendance_select_self on student_attendance;
create policy student_attendance_select on student_attendance for select
  using (
    auth_is_super_admin()
    or (school_id = auth_school_id() and auth_has_permission('attendance.read'))
    or auth_user_id_is_guardian_of(student_attendance.student_id)
    or exists (select 1 from students st join school_users su on su.id = st.school_user_id where st.id = student_attendance.student_id and su.auth_user_id = (select auth.uid()))
  );

drop policy timetable_slots_select on timetable_slots;
drop policy timetable_slots_select_self on timetable_slots;
drop policy timetable_slots_select_guardian on timetable_slots;
create policy timetable_slots_select on timetable_slots for select
  using (
    auth_is_super_admin()
    or (school_id = auth_school_id() and auth_has_permission('academics.read'))
    or exists (select 1 from students st join school_users su on su.id = st.school_user_id where su.auth_user_id = (select auth.uid()) and st.current_class_id = timetable_slots.stream_id)
    or exists (select 1 from students st join student_guardians sg on sg.student_id = st.id join school_users su on su.id = sg.guardian_user_id where su.auth_user_id = (select auth.uid()) and st.current_class_id = timetable_slots.stream_id)
  );
