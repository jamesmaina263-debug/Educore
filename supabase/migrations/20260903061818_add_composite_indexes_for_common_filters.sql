-- Composite indexes for the school_id + entity query patterns the app actually runs
-- (dashboards, report cards, fee statements, attendance registers, class result sheets).
-- A single-column school_id index lets Postgres narrow to one tenant; these composites
-- avoid a second filter pass once inside that tenant's rows, which matters once a school
-- has thousands of students / tens of thousands of attendance & marks rows.

create index if not exists idx_student_attendance_school_student on public.student_attendance (school_id, student_id, created_at desc);
create index if not exists idx_student_attendance_school_stream on public.student_attendance (school_id, stream_id, created_at desc);
create index if not exists idx_staff_attendance_school_staff on public.staff_attendance (school_id, staff_id, created_at desc);

create index if not exists idx_marks_school_exam_student on public.marks (school_id, exam_id, student_id);
create index if not exists idx_marks_school_exam_class on public.marks (school_id, exam_id, class_id);
create index if not exists idx_competency_marks_school_exam_student on public.competency_marks (school_id, exam_id, student_id);
create index if not exists idx_competency_marks_school_exam_class on public.competency_marks (school_id, exam_id, class_id);

create index if not exists idx_invoices_school_student on public.invoices (school_id, student_id);
create index if not exists idx_invoices_school_term on public.invoices (school_id, term_id);
create index if not exists idx_invoices_school_status on public.invoices (school_id, status);
create index if not exists idx_payments_school_student on public.payments (school_id, student_id);
create index if not exists idx_mpesa_stk_requests_school_status on public.mpesa_stk_requests (school_id, status);

create index if not exists idx_notification_logs_school_created on public.notification_logs (school_id, created_at desc);
create index if not exists idx_whatsapp_messages_school_created on public.whatsapp_messages (school_id, created_at desc);
create index if not exists idx_audit_log_school_created on public.audit_log (school_id, created_at desc);
