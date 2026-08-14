-- ============================================================================
-- Phase 15 (6/6) FINAL MODULE: Attendance -- correction/approval workflow
-- (Brief 4.13)
-- student_attendance/staff_attendance already handle present/absent/late/
-- excused/sick_bay and boarding integration correctly (REUSE, confirmed via
-- schema inspection: status already includes 'excused', boarding integrates
-- via the existing session column rather than a separate table). This adds
-- the one genuinely missing piece: a correction request/approval workflow,
-- since edit_reason previously let anyone with attendance.mark silently
-- overwrite a past record with no review step.
-- ============================================================================

alter table public.student_attendance
  add column correction_status text not null default 'none' check (correction_status in ('none','pending','approved','rejected')),
  add column requested_status text check (requested_status in ('present','absent','late','sick_bay','excused')),
  add column correction_reason text,
  add column requested_by uuid references public.school_users(id),
  add column reviewed_by uuid references public.school_users(id),
  add column reviewed_at timestamptz;

insert into public.role_permissions (role_id, permission_key, allowed)
select r.id, 'attendance.approve_correction', true
from public.roles r
where r.name = 'class_teacher'
  and not exists (select 1 from public.role_permissions rp where rp.role_id = r.id and rp.school_id is null and rp.permission_key = 'attendance.approve_correction');

insert into public.role_permissions (role_id, permission_key, allowed)
select r.id, 'attendance.approve_correction', true
from public.roles r
where r.name in ('deputy_principal', 'principal', 'school_owner')
  and not exists (select 1 from public.role_permissions rp where rp.role_id = r.id and rp.school_id is null and rp.permission_key = 'attendance.approve_correction');

-- Applying an approved/rejected correction touches only correction_status,
-- requested_status, reviewed_by/at, and (once approved) status itself --
-- same column-level trust the existing marks.approve/report_cards.approve
-- policies already place in the permission check, not enforced at the
-- column level, consistent with every other approval pattern in this
-- codebase.
create policy student_attendance_approve_any on public.student_attendance for update
  using (auth_is_super_admin() or (school_id = auth_school_id() and auth_has_permission('attendance.approve_correction') and auth_has_permission('attendance.mark_any')))
  with check (auth_is_super_admin() or (school_id = auth_school_id() and auth_has_permission('attendance.approve_correction') and auth_has_permission('attendance.mark_any')));

create policy student_attendance_approve_own_class on public.student_attendance for update
  using (
    auth_is_super_admin() or (
      school_id = auth_school_id()
      and auth_has_permission('attendance.approve_correction')
      and exists (select 1 from public.streams st where st.id = student_attendance.stream_id and st.class_teacher_id = auth_school_user_id())
    )
  );
