-- Wrap bare auth.uid()/auth.role() calls in "(select ...)" so Postgres evaluates them
-- once per query (InitPlan) instead of once per row. On tables with thousands of rows
-- per school this is the difference between a few ms and a multi-second query.
-- Behavior is unchanged; only evaluation frequency changes.

alter policy roles_select on public.roles
  using ((select auth.role()) = 'authenticated');

alter policy school_users_update on public.school_users
  using (auth_is_super_admin() OR (auth_user_id = (select auth.uid())) OR ((school_id = auth_school_id()) AND auth_has_permission('staff.manage')))
  with check (auth_is_super_admin() OR (auth_user_id = (select auth.uid())) OR ((school_id = auth_school_id()) AND auth_has_permission('staff.manage')));

alter policy students_select on public.students
  using (auth_is_super_admin() OR ((school_id = auth_school_id()) AND auth_has_permission('students.read')) OR auth_user_id_is_guardian_of(id) OR (school_user_id = (select school_users.id from school_users where school_users.auth_user_id = (select auth.uid()) and school_users.status = 'active')));

alter policy student_guardians_select on public.student_guardians
  using (auth_is_super_admin() OR (exists (select 1 from students s where s.id = student_guardians.student_id and s.school_id = auth_school_id() and auth_has_permission('students.read'))) OR (guardian_user_id = (select school_users.id from school_users where school_users.auth_user_id = (select auth.uid()) and school_users.status = 'active')));

alter policy report_cards_update_own_class on public.report_cards
  using ((school_id = auth_school_id()) AND auth_has_permission('report_cards.approve') AND (exists (select 1 from students s join streams st on st.id = s.current_class_id where s.id = report_cards.student_id and st.class_teacher_id = (select school_users.id from school_users where school_users.auth_user_id = (select auth.uid())))))
  with check ((school_id = auth_school_id()) AND auth_has_permission('report_cards.approve') AND (exists (select 1 from students s join streams st on st.id = s.current_class_id where s.id = report_cards.student_id and st.class_teacher_id = (select school_users.id from school_users where school_users.auth_user_id = (select auth.uid())))));

alter policy fee_waivers_select on public.fee_waivers
  using (((school_id = auth_school_id()) AND auth_has_permission('finance.read')) OR auth_user_id_is_guardian_of(student_id) OR (exists (select 1 from students st join school_users su on su.id = st.school_user_id where st.id = fee_waivers.student_id and su.auth_user_id = (select auth.uid()))));

alter policy competency_marks_select on public.competency_marks
  using (((school_id = auth_school_id()) AND auth_has_permission('exams.read')) OR (auth_user_id_is_guardian_of(student_id) AND (exists (select 1 from report_cards rc where rc.exam_id = competency_marks.exam_id and rc.student_id = competency_marks.student_id and rc.comment_source = any (array['teacher_approved','teacher_written'])))) OR ((exists (select 1 from students st join school_users su on su.id = st.school_user_id where st.id = competency_marks.student_id and su.auth_user_id = (select auth.uid()))) AND (exists (select 1 from report_cards rc where rc.exam_id = competency_marks.exam_id and rc.student_id = competency_marks.student_id and rc.comment_source = any (array['teacher_approved','teacher_written'])))));

alter policy staff_attendance_select on public.staff_attendance
  using (auth_is_super_admin() OR ((school_id = auth_school_id()) AND auth_has_permission('staff_attendance.read_any')) OR (exists (select 1 from school_users su where su.id = staff_attendance.staff_id and su.auth_user_id = (select auth.uid()))));

alter policy competency_evidence_select on public.competency_evidence
  using (((school_id = auth_school_id()) AND auth_has_permission('exams.read')) OR (exists (select 1 from competency_marks cm where cm.id = competency_evidence.competency_mark_id and ((auth_user_id_is_guardian_of(cm.student_id) AND (exists (select 1 from report_cards rc where rc.exam_id = cm.exam_id and rc.student_id = cm.student_id and rc.comment_source = any (array['teacher_approved','teacher_written'])))) OR ((exists (select 1 from students st join school_users su on su.id = st.school_user_id where st.id = cm.student_id and su.auth_user_id = (select auth.uid()))) AND (exists (select 1 from report_cards rc where rc.exam_id = cm.exam_id and rc.student_id = cm.student_id and rc.comment_source = any (array['teacher_approved','teacher_written']))))))));

alter policy discipline_records_update on public.discipline_records
  using ((school_id = auth_school_id()) AND (auth_has_permission('discipline.read_any') OR (recorded_by = (select su.id from school_users su where su.auth_user_id = (select auth.uid())))) AND auth_has_permission('discipline.write'))
  with check ((school_id = auth_school_id()) AND (auth_has_permission('discipline.read_any') OR (recorded_by = (select su.id from school_users su where su.auth_user_id = (select auth.uid())))) AND auth_has_permission('discipline.write'));

alter policy staff_qualifications_select on public.staff_qualifications
  using (auth_is_super_admin() OR ((school_id = auth_school_id()) AND auth_has_permission('staff.read')) OR (staff_id = (select school_users.id from school_users where school_users.auth_user_id = (select auth.uid()) and school_users.status = 'active')));

alter policy library_loans_select on public.library_loans
  using (auth_is_super_admin() OR ((school_id = auth_school_id()) AND auth_has_permission('library.read_any')) OR (auth_user_id_is_guardian_of(student_id) AND (exists (select 1 from students st where st.id = library_loans.student_id and st.school_id = library_loans.school_id))) OR (exists (select 1 from students st where st.id = library_loans.student_id and st.school_user_id = (select su.id from school_users su where su.auth_user_id = (select auth.uid()) and su.status = 'active'))) OR (staff_id = auth_school_user_id()));

alter policy leave_requests_select on public.leave_requests
  using (auth_is_super_admin() OR ((school_id = auth_school_id()) AND (auth_has_permission('staff.read') OR auth_has_permission('staff.leave.approve'))) OR (staff_id = (select school_users.id from school_users where school_users.auth_user_id = (select auth.uid()) and school_users.status = 'active')));

alter policy leave_requests_insert on public.leave_requests
  with check (auth_is_super_admin() OR (staff_id = (select school_users.id from school_users where school_users.auth_user_id = (select auth.uid()) and school_users.status = 'active')) OR ((school_id = auth_school_id()) AND auth_has_permission('staff.manage')));

alter policy leave_requests_update_own_pending on public.leave_requests
  using ((staff_id = (select school_users.id from school_users where school_users.auth_user_id = (select auth.uid()) and school_users.status = 'active')) AND (status = 'pending'))
  with check ((staff_id = (select school_users.id from school_users where school_users.auth_user_id = (select auth.uid()) and school_users.status = 'active')) AND (status = any (array['pending','cancelled'])));

alter policy notification_logs_select on public.notification_logs
  using (((school_id = auth_school_id()) AND auth_has_permission('communication.read')) OR (recipient_school_user_id = (select school_users.id from school_users where school_users.auth_user_id = (select auth.uid()))) OR ((school_id = auth_school_id()) AND (recipient_type = 'supplier') AND auth_has_permission('communication.supplier')));

alter policy applications_select on public.applications
  using (auth_is_super_admin() OR ((school_id = auth_school_id()) AND auth_has_permission('admissions.read_any')) OR ((guardian_id is not null) AND (guardian_id = (select school_users.id from school_users where school_users.auth_user_id = (select auth.uid()) and school_users.status = 'active'))));

alter policy documents_select on public.documents
  using (auth_is_super_admin() OR ((school_id = auth_school_id()) AND (student_id is not null) AND auth_has_permission('students.documents.read')) OR ((student_id is not null) AND auth_user_id_is_guardian_of(student_id)) OR ((school_id = auth_school_id()) AND (staff_id is not null) AND auth_has_permission('staff.read')) OR ((staff_id is not null) AND (staff_id = (select school_users.id from school_users where school_users.auth_user_id = (select auth.uid()) and school_users.status = 'active'))) OR ((school_id = auth_school_id()) AND (application_id is not null) AND auth_has_permission('admissions.read_any')) OR ((application_id is not null) AND (application_id in (select applications.id from applications where applications.guardian_id = (select school_users.id from school_users where school_users.auth_user_id = (select auth.uid()) and school_users.status = 'active')))));
