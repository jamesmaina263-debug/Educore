-- Phase 1: Biometric gate attendance for STUDENTS + parent notification.
-- Purely additive: new tables + one new allowed category value on two existing
-- check constraints. No existing table, column, row, policy, or trigger is
-- altered or dropped.

-- 1. Allow a 'gate_attendance' category on the existing communication
--    templates / notification preferences infrastructure, so schools can
--    author their own check-in/check-out SMS wording and parents can opt
--    out of just this category if they want, same as fee_reminder etc.
alter table public.communication_templates
  drop constraint communication_templates_category_check;
alter table public.communication_templates
  add constraint communication_templates_category_check
  check (category = any (array[
    'fee_reminder','absence_alert','result_published','announcement',
    'other','term_newsletter','fee_threshold_alert','gate_attendance'
  ]));

alter table public.notification_preferences
  drop constraint notification_preferences_category_check;
alter table public.notification_preferences
  add constraint notification_preferences_category_check
  check (category = any (array[
    'fee_reminder','absence_alert','result_published','announcement',
    'other','gate_attendance'
  ]));

-- 2. Registered biometric scanners (one row per physical device/gate).
create table public.biometric_devices (
  id uuid primary key default gen_random_uuid(),
  school_id uuid not null references public.schools(id),
  name text not null,
  device_type text not null default 'fingerprint'
    check (device_type = any (array['fingerprint','face','card','other'])),
  serial_number text,
  location text,
  api_key_prefix text unique,
  api_key_hash text,
  status text not null default 'active'
    check (status = any (array['active','inactive'])),
  created_by uuid references public.school_users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
comment on table public.biometric_devices is
  'One row per physical biometric scanner (a gate, a library entrance, etc). api_key_hash is sha256 of the device secret, same pattern as api_keys.key_hash -- the secret itself is shown once at creation and never stored.';

create trigger trg_biometric_devices_updated_at
  before update on public.biometric_devices
  for each row execute function public.set_updated_at();

alter table public.biometric_devices enable row level security;

create policy biometric_devices_all on public.biometric_devices
  for all
  using (auth_is_super_admin() or ((school_id = auth_school_id()) and auth_has_permission('gate.manage')))
  with check (auth_is_super_admin() or ((school_id = auth_school_id()) and auth_has_permission('gate.manage')));

-- 3. Which biometric template on which device belongs to which person.
--    person_type/person_id is a soft polymorphic reference (student or
--    staff) validated by trigger below, since a single FK can't span two
--    target tables.
create table public.biometric_enrollments (
  id uuid primary key default gen_random_uuid(),
  school_id uuid not null references public.schools(id),
  device_id uuid not null references public.biometric_devices(id),
  person_type text not null check (person_type = any (array['student','staff'])),
  person_id uuid not null,
  external_template_id text not null,
  status text not null default 'active'
    check (status = any (array['active','revoked'])),
  enrolled_by uuid references public.school_users(id),
  enrolled_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (device_id, external_template_id)
);
comment on table public.biometric_enrollments is
  'Maps a fingerprint/face template ID reported by a specific device to a student or staff member. A gate scan carries (device_id, external_template_id); this table is how we resolve that back to a person.';

create trigger trg_biometric_enrollments_updated_at
  before update on public.biometric_enrollments
  for each row execute function public.set_updated_at();

create or replace function public.validate_biometric_enrollment_person()
returns trigger
language plpgsql
set search_path to 'public'
as $$
begin
  if new.person_type = 'student' then
    if not exists (select 1 from public.students s where s.id = new.person_id and s.school_id = new.school_id) then
      raise exception 'person_id % is not a student of school %', new.person_id, new.school_id;
    end if;
  elsif new.person_type = 'staff' then
    if not exists (select 1 from public.school_users su where su.id = new.person_id and su.school_id = new.school_id) then
      raise exception 'person_id % is not a staff member of school %', new.person_id, new.school_id;
    end if;
  end if;
  return new;
end;
$$;

create trigger trg_validate_biometric_enrollment_person
  before insert or update on public.biometric_enrollments
  for each row execute function public.validate_biometric_enrollment_person();

alter table public.biometric_enrollments enable row level security;

create policy biometric_enrollments_all on public.biometric_enrollments
  for all
  using (auth_is_super_admin() or ((school_id = auth_school_id()) and auth_has_permission('gate.manage')))
  with check (auth_is_super_admin() or ((school_id = auth_school_id()) and auth_has_permission('gate.manage')));

-- 4. The actual scan log for students -- an append-only raw event feed,
--    deliberately separate from student_attendance (the teacher-marked
--    daily register) so a gate scan never silently overwrites a teacher's
--    own attendance mark. A future trigger/report can cross-reference the
--    two; today it just records ground truth of what the gate saw.
create table public.student_gate_events (
  id uuid primary key default gen_random_uuid(),
  school_id uuid not null references public.schools(id),
  student_id uuid not null references public.students(id),
  device_id uuid references public.biometric_devices(id),
  event_type text not null check (event_type = any (array['check_in','check_out'])),
  event_at timestamptz not null default now(),
  source text not null default 'biometric' check (source = any (array['biometric','manual'])),
  recorded_by uuid references public.school_users(id),
  notification_status text not null default 'pending'
    check (notification_status = any (array['pending','sent','failed','skipped'])),
  notification_log_id uuid references public.notification_logs(id),
  created_at timestamptz not null default now()
);
comment on table public.student_gate_events is
  'Raw gate scan log for students (biometric or manual override). notification_status/notification_log_id track whether the arrival/departure SMS to guardians went out for this specific event -- immutable event log, same no-update convention as ai_query_logs/audit_log.';

create index idx_student_gate_events_student_at on public.student_gate_events (student_id, event_at desc);
create index idx_student_gate_events_school_at on public.student_gate_events (school_id, event_at desc);

alter table public.student_gate_events enable row level security;

-- Insert: biometric scans arrive via a service-role Edge Function (bypasses
-- RLS entirely), so this policy only governs manual staff entry/override.
create policy student_gate_events_insert on public.student_gate_events
  for insert
  with check (
    auth_is_super_admin()
    or ((school_id = auth_school_id()) and auth_has_permission('gate.manage'))
  );

-- Notification bookkeeping fields can be updated by the sending pipeline /
-- authorised staff; the event facts themselves (student, type, time) are
-- not expected to change, but we allow the same permission to correct one
-- if needed, matching student_attendance's own edit_reason-gated pattern
-- at the app layer rather than forbidding update outright at the DB layer.
create policy student_gate_events_update on public.student_gate_events
  for update
  using (auth_is_super_admin() or ((school_id = auth_school_id()) and auth_has_permission('gate.manage')))
  with check (auth_is_super_admin() or ((school_id = auth_school_id()) and auth_has_permission('gate.manage')));

create policy student_gate_events_select on public.student_gate_events
  for select
  using (
    auth_is_super_admin()
    or ((school_id = auth_school_id()) and auth_has_permission('gate.manage'))
    or ((school_id = auth_school_id()) and auth_has_permission('attendance.read'))
    or auth_user_id_is_guardian_of(student_id)
    or exists (
      select 1 from public.students st
      join public.school_users su on su.id = st.school_user_id
      where st.id = student_gate_events.student_id
        and su.auth_user_id = (select auth.uid())
    )
  );

-- 5. New permission keys, following the existing module.verb convention.
--    Not auto-granted to any role here -- a super_admin/owner assigns
--    gate.manage to whichever role (e.g. Security Officer, Deputy
--    Principal) should administer devices and review/override gate events,
--    same as every other permission_key in this system.
comment on column public.role_permissions.permission_key is
  'Includes gate.manage (administer biometric devices/enrollments, review or manually override gate events) as of the biometric gate attendance feature. See other permission_key values for the full catalogue.';
