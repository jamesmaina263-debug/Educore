
-- Generic audit log (designed in the blueprint under Platform; built now because
-- Attendance's own business rule requires it -- not scope creep, a real dependency).
create table audit_log (
  id uuid primary key default gen_random_uuid(),
  school_id uuid not null references schools(id),
  actor_school_user_id uuid references school_users(id),
  table_name text not null,
  record_id uuid not null,
  action text not null,
  reason text,
  old_data jsonb,
  new_data jsonb,
  created_at timestamptz not null default now()
);
create index audit_log_school_created_idx on audit_log(school_id, created_at);
create index audit_log_record_idx on audit_log(table_name, record_id);
alter table audit_log enable row level security;

insert into role_permissions (role_id, permission_key, allowed)
select id, 'audit.read', true from roles where name in ('school_owner','principal');

create policy audit_log_select on audit_log for select
  using (auth_is_super_admin() or (school_id = auth_school_id() and auth_has_permission('audit.read')));
-- no insert/update/delete policy for regular users: audit_log is written only via
-- SECURITY DEFINER trigger functions, never directly by client requests.

-- Student attendance (class-day register, not per-period, matching MVP scope)
create table student_attendance (
  id uuid primary key default gen_random_uuid(),
  school_id uuid not null references schools(id),
  student_id uuid not null references students(id),
  stream_id uuid not null references streams(id),
  attendance_date date not null,
  status text not null check (status in ('present','absent','late')),
  marked_by uuid references school_users(id),
  edit_reason text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (stream_id, student_id, attendance_date)
);
create index student_attendance_school_created_idx on student_attendance(school_id, created_at);
create index student_attendance_student_idx on student_attendance(student_id, attendance_date);
alter table student_attendance enable row level security;
create trigger trg_student_attendance_updated_at before update on student_attendance
  for each row execute function set_updated_at();
