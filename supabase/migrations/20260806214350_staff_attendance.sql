-- Staff attendance (Gap Analysis Tier 2 #11) -- deferred since MVP,
-- mirrors student_attendance's shape (status/edit_reason/marked_by
-- pattern) but staff aren't stream-scoped, so it's a flat per-school table
-- with its own permission tier rather than the class-teacher-of-stream
-- check student attendance uses.
create table staff_attendance (
  id uuid primary key default gen_random_uuid(),
  school_id uuid not null references schools(id),
  staff_id uuid not null references school_users(id),
  attendance_date date not null,
  status text not null check (status in ('present','absent','late','on_leave','half_day')),
  check_in_time time,
  check_out_time time,
  marked_by uuid references school_users(id),
  edit_reason text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (staff_id, attendance_date)
);
comment on table staff_attendance is 'Daily staff attendance -- flat per-school table, not stream-scoped like student_attendance. Marking is an HR/admin function (Deputy Principal in most Kenyan schools), distinct from Payroll which has its own approval workflow -- this is a factual daily record with no approval step, same as student attendance.';

create index idx_staff_attendance_school_date on staff_attendance(school_id, attendance_date);
create index idx_staff_attendance_staff on staff_attendance(staff_id);

alter table staff_attendance enable row level security;

-- New permission tier: staff_attendance.mark / staff_attendance.read_any,
-- Deputy Principal + Principal + Owner -- an HR/admin-tier function,
-- distinct from Payroll's owner-only approve (marking daily attendance
-- doesn't need the same financial-approval gate as authorizing pay).
insert into role_permissions (role_id, school_id, permission_key, allowed)
select id, null, 'staff_attendance.mark', true from roles where name in ('deputy_principal','principal','school_owner');
insert into role_permissions (role_id, school_id, permission_key, allowed)
select id, null, 'staff_attendance.read_any', true from roles where name in ('deputy_principal','principal','school_owner');

create policy staff_attendance_select on staff_attendance
  for select to authenticated
  using (
    auth_is_super_admin()
    or (school_id = auth_school_id() and auth_has_permission('staff_attendance.read_any'))
    or exists (select 1 from school_users su where su.id = staff_attendance.staff_id and su.auth_user_id = auth.uid())
  );

create policy staff_attendance_write on staff_attendance
  for all to authenticated
  using (auth_is_super_admin() or (school_id = auth_school_id() and auth_has_permission('staff_attendance.mark')))
  with check (auth_is_super_admin() or (school_id = auth_school_id() and auth_has_permission('staff_attendance.mark')));
