
-- Portal read-access pass. Several tables from Items 1-2 deliberately deferred parent/student RLS
-- until Portals existed to consume it (same precedent as Medical Records in Phase 1). Adding it now.

-- report_cards: a parent/student may see a report card ONLY once it's "published" — defined here as
-- comment_source in ('teacher_approved','teacher_written'). This is a real design decision, not
-- explicitly spelled out in the blueprint at this granularity: it means a report card with NO
-- comment yet (comment_source='none') is also withheld, not just an unapproved AI draft. Chosen
-- because (a) it's the cleanest way to guarantee "no AI text reaches a parent unreviewed, ever" at
-- the RLS layer rather than relying on UI-only masking (Supabase auto-exposes every table via REST,
-- so a row-visibility rule is the only real enforcement), and (b) schools don't typically release
-- partial report cards — marks-without-commentary isn't "published" in practice either.
create policy report_cards_select_guardian on report_cards for select
  using (auth_user_id_is_guardian_of(report_cards.student_id) and comment_source in ('teacher_approved', 'teacher_written'));
create policy report_cards_select_self on report_cards for select
  using (
    comment_source in ('teacher_approved', 'teacher_written')
    and exists (select 1 from students st join school_users su on su.id = st.school_user_id where st.id = report_cards.student_id and su.auth_user_id = (select auth.uid()))
  );

-- marks/class_rankings: gated behind the SAME "published report card exists" check, so raw marks or
-- a rank never leak to a family before the report card they belong to is actually released.
create policy marks_select_guardian on marks for select
  using (
    auth_user_id_is_guardian_of(marks.student_id)
    and exists (select 1 from report_cards rc where rc.exam_id = marks.exam_id and rc.student_id = marks.student_id and rc.comment_source in ('teacher_approved', 'teacher_written'))
  );
create policy marks_select_self on marks for select
  using (
    exists (select 1 from students st join school_users su on su.id = st.school_user_id where st.id = marks.student_id and su.auth_user_id = (select auth.uid()))
    and exists (select 1 from report_cards rc where rc.exam_id = marks.exam_id and rc.student_id = marks.student_id and rc.comment_source in ('teacher_approved', 'teacher_written'))
  );

create policy class_rankings_select_guardian on class_rankings for select
  using (
    auth_user_id_is_guardian_of(class_rankings.student_id)
    and exists (select 1 from report_cards rc where rc.exam_id = class_rankings.exam_id and rc.student_id = class_rankings.student_id and rc.comment_source in ('teacher_approved', 'teacher_written'))
  );
create policy class_rankings_select_self on class_rankings for select
  using (
    exists (select 1 from students st join school_users su on su.id = st.school_user_id where st.id = class_rankings.student_id and su.auth_user_id = (select auth.uid()))
    and exists (select 1 from report_cards rc where rc.exam_id = class_rankings.exam_id and rc.student_id = class_rankings.student_id and rc.comment_source in ('teacher_approved', 'teacher_written'))
  );

-- student_attendance: guardian read already existed (Phase 1); adding the missing student-self read.
create policy student_attendance_select_self on student_attendance for select
  using (exists (select 1 from students st join school_users su on su.id = st.school_user_id where st.id = student_attendance.student_id and su.auth_user_id = (select auth.uid())));

-- timetable_slots: previously staff-only (academics.read). A student needs their own stream's
-- timetable, and a guardian needs their child's — neither existed at all until now.
create policy timetable_slots_select_self on timetable_slots for select
  using (
    exists (
      select 1 from students st join school_users su on su.id = st.school_user_id
      where su.auth_user_id = (select auth.uid()) and st.current_class_id = timetable_slots.stream_id
    )
  );
create policy timetable_slots_select_guardian on timetable_slots for select
  using (
    exists (
      select 1 from students st join student_guardians sg on sg.student_id = st.id join school_users su on su.id = sg.guardian_user_id
      where su.auth_user_id = (select auth.uid()) and st.current_class_id = timetable_slots.stream_id
    )
  );
