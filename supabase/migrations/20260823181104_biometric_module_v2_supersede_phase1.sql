-- Biometric module v2: supersedes the Phase 1 (biometric_enrollments /
-- student_gate_events) design with the fuller profile/credential/event/
-- verification model, and wires attendance into the *existing* pattern
-- this codebase already uses for exactly this kind of thing: the
-- `student_attendance.session` column, added for boarding AM/PM roll call
-- so a student can have more than one attendance row per day without
-- colliding with the teacher-marked 'class' session. A gate scan gets its
-- own 'gate' session value the same way -- not a parallel attendance
-- system, the same table, same unique-per-session constraint, same
-- correction workflow, just a new session value.
--
-- Nothing here ever stores a fingerprint image, face image, raw template,
-- or embedding. The device/provider performs the actual biometric match
-- locally and reports back only: which of ITS OWN opaque reference IDs
-- matched (credential_reference) and the result. That reference is the
-- only biometric-adjacent thing EduCore ever stores.

-- ============================================================
-- 1. Retire the Phase 1 schema
-- ============================================================
drop policy if exists student_gate_events_select on public.student_gate_events;
drop policy if exists student_gate_events_update on public.student_gate_events;
drop policy if exists student_gate_events_insert on public.student_gate_events;
drop table if exists public.student_gate_events;

drop trigger if exists trg_validate_biometric_enrollment_person on public.biometric_enrollments;
drop policy if exists biometric_enrollments_all on public.biometric_enrollments;
drop table if exists public.biometric_enrollments;
drop function if exists public.validate_biometric_enrollment_person();

-- biometric_devices is kept (device registration is still correct) but
-- reshaped slightly: add a provider abstraction column, rename
-- last_used_at -> last_seen_at to match "last-seen" language used in the
-- spec, and drop the old permissive all-in-one policy in favour of the
-- more granular permission split below.
drop policy if exists biometric_devices_all on public.biometric_devices;
alter table public.biometric_devices add column provider text not null default 'generic';
alter table public.biometric_devices rename column last_used_at to last_seen_at;
comment on column public.biometric_devices.provider is
  'Vendor/integration abstraction (e.g. zkteco, hikvision, generic_webhook) -- lets another device/provider be added later without restructuring biometric_credentials or biometric_events, which never reference a vendor directly.';

-- ============================================================
-- 2. Granular permissions (module.verb convention, same as everywhere
--    else) -- not pre-granted to any role; an owner/admin assigns these
--    like any other permission_key.
-- ============================================================
comment on column public.role_permissions.permission_key is
  'Includes the biometric module keys: biometric.view (profiles/credentials),
   biometric.enroll (enroll a credential), biometric.revoke (revoke a
   credential), biometric.devices_manage (register/administer devices),
   biometric.events_read (view the biometric event/verification audit log).
   See other permission_key values for the full catalogue.';

-- ============================================================
-- 3. biometric_profiles -- references an EXISTING student or staff
--    identity. Never a new person record.
-- ============================================================
create table public.biometric_profiles (
  id uuid primary key default gen_random_uuid(),
  school_id uuid not null references public.schools(id),
  person_type text not null check (person_type = any (array['student','staff'])),
  person_id uuid not null,
  status text not null default 'active' check (status = any (array['active','inactive'])),
  created_by uuid references public.school_users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (school_id, person_type, person_id)
);
comment on table public.biometric_profiles is
  'One row per student/staff who has been set up for biometric verification. Links to the existing students/school_users identity -- never a duplicate person record. The actual enrolled credential(s) live in biometric_credentials.';

create trigger trg_biometric_profiles_updated_at
  before update on public.biometric_profiles
  for each row execute function public.set_updated_at();

create or replace function public.validate_biometric_profile_person()
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

create trigger trg_validate_biometric_profile_person
  before insert or update on public.biometric_profiles
  for each row execute function public.validate_biometric_profile_person();

alter table public.biometric_profiles enable row level security;

create policy biometric_profiles_select on public.biometric_profiles
  for select
  using (
    auth_is_super_admin()
    or ((school_id = auth_school_id()) and (auth_has_permission('biometric.view') or auth_has_permission('biometric.enroll')))
    or (person_type = 'student' and auth_user_id_is_guardian_of(person_id))
    or exists (select 1 from public.school_users su where su.school_id = biometric_profiles.school_id and su.auth_user_id = (select auth.uid())
               and ((person_type='staff' and su.id = person_id) or (person_type='student' and exists (select 1 from public.students st where st.id = person_id and st.school_user_id = su.id))))
  );

create policy biometric_profiles_write on public.biometric_profiles
  for insert
  with check (auth_is_super_admin() or ((school_id = auth_school_id()) and auth_has_permission('biometric.enroll')));

create policy biometric_profiles_update on public.biometric_profiles
  for update
  using (auth_is_super_admin() or ((school_id = auth_school_id()) and auth_has_permission('biometric.enroll')))
  with check (auth_is_super_admin() or ((school_id = auth_school_id()) and auth_has_permission('biometric.enroll')));

-- ============================================================
-- 4. biometric_credentials -- ONLY a reference + metadata. Never the
--    biometric itself. Revocable and re-enrollable; a profile can have
--    more than one (e.g. fingerprint + face, or a re-enrollment after a
--    device swap without losing history).
-- ============================================================
create table public.biometric_credentials (
  id uuid primary key default gen_random_uuid(),
  school_id uuid not null references public.schools(id),
  profile_id uuid not null references public.biometric_profiles(id) on delete cascade,
  credential_type text not null check (credential_type = any (array['fingerprint','face'])),
  provider text not null default 'generic',
  device_id uuid references public.biometric_devices(id),
  credential_reference text not null,
  template_version text,
  status text not null default 'active' check (status = any (array['active','revoked'])),
  enrolled_by uuid references public.school_users(id),
  enrolled_at timestamptz not null default now(),
  revoked_by uuid references public.school_users(id),
  revoked_at timestamptz,
  updated_at timestamptz not null default now(),
  unique (device_id, credential_reference)
);
comment on table public.biometric_credentials is
  'credential_reference is an OPAQUE ID issued by the device/provider (a template slot number, a provider-side enrollment ID) -- never a fingerprint image, face image, raw template, or embedding. The actual biometric data and the matching operation live entirely on the device/provider side; this row is only enough to know "this reference belongs to this profile" and whether it is currently valid.';

create trigger trg_biometric_credentials_updated_at
  before update on public.biometric_credentials
  for each row execute function public.set_updated_at();

create index idx_biometric_credentials_profile on public.biometric_credentials(profile_id) where status = 'active';

alter table public.biometric_credentials enable row level security;

create policy biometric_credentials_select on public.biometric_credentials
  for select
  using (auth_is_super_admin() or ((school_id = auth_school_id()) and (auth_has_permission('biometric.view') or auth_has_permission('biometric.enroll'))));

create policy biometric_credentials_insert on public.biometric_credentials
  for insert
  with check (auth_is_super_admin() or ((school_id = auth_school_id()) and auth_has_permission('biometric.enroll')));

create policy biometric_credentials_update on public.biometric_credentials
  for update
  using (auth_is_super_admin() or ((school_id = auth_school_id()) and (auth_has_permission('biometric.enroll') or auth_has_permission('biometric.revoke'))))
  with check (auth_is_super_admin() or ((school_id = auth_school_id()) and (auth_has_permission('biometric.enroll') or auth_has_permission('biometric.revoke'))));

-- ============================================================
-- 5. biometric_devices: replace the old all-in-one policy with the
--    biometric.devices_manage-gated one.
-- ============================================================
create policy biometric_devices_all on public.biometric_devices
  for all
  using (auth_is_super_admin() or ((school_id = auth_school_id()) and auth_has_permission('biometric.devices_manage')))
  with check (auth_is_super_admin() or ((school_id = auth_school_id()) and auth_has_permission('biometric.devices_manage')));

-- ============================================================
-- 6. biometric_verifications -- audit of every match ATTEMPT, success or
--    failure. The device performs the match locally; this only records
--    what it reported. Never contains raw biometric data.
-- ============================================================
create table public.biometric_verifications (
  id uuid primary key default gen_random_uuid(),
  school_id uuid not null references public.schools(id),
  device_id uuid references public.biometric_devices(id),
  credential_reference text,
  profile_id uuid references public.biometric_profiles(id),
  result text not null check (result = any (array[
    'success','failed','unknown_credential','revoked_credential','inactive_profile','device_inactive'
  ])),
  occurred_at timestamptz not null default now(),
  created_at timestamptz not null default now()
);
comment on table public.biometric_verifications is
  'Immutable audit log of every verification attempt a device reported, including failures -- credential_reference is the opaque ID the device claimed matched (or attempted), never biometric data itself.';

create index idx_biometric_verifications_school_at on public.biometric_verifications(school_id, occurred_at desc);
create index idx_biometric_verifications_profile on public.biometric_verifications(profile_id, occurred_at desc);

alter table public.biometric_verifications enable row level security;

create policy biometric_verifications_select on public.biometric_verifications
  for select
  using (auth_is_super_admin() or ((school_id = auth_school_id()) and auth_has_permission('biometric.events_read')));

-- ============================================================
-- 7. biometric_events -- immutable, ground-truth record of what actually
--    happened (as opposed to verifications, which record match attempts).
--    event_id is a CLIENT-SUPPLIED idempotency key so a device/kiosk that
--    buffered scans while offline and retries on reconnect can never
--    create a duplicate event, independent of our own `id`.
-- ============================================================
create table public.biometric_events (
  id uuid primary key default gen_random_uuid(),
  school_id uuid not null references public.schools(id),
  event_id text not null,
  device_id uuid references public.biometric_devices(id),
  profile_id uuid not null references public.biometric_profiles(id),
  person_type text not null check (person_type = any (array['student','staff'])),
  person_id uuid not null,
  event_type text not null check (event_type = any (array['check_in','check_out'])),
  occurred_at timestamptz not null,
  received_at timestamptz not null default now(),
  verification_id uuid references public.biometric_verifications(id),
  attendance_table text,
  attendance_id uuid,
  notification_status text not null default 'pending'
    check (notification_status = any (array['pending','sent','failed','skipped','not_applicable'])),
  notification_log_id uuid references public.notification_logs(id),
  created_at timestamptz not null default now(),
  unique (device_id, event_id)
);
comment on table public.biometric_events is
  'Immutable ground-truth event log ("what happened"), feeding into the existing attendance module rather than a parallel one -- attendance_table/attendance_id point at whichever existing attendance row (student_attendance session=''gate'', or staff_attendance) this event resulted in, or stay null if the event was logged but did not change attendance (e.g. a same-day duplicate, or a check_out which does not create a second attendance row). person_type/person_id are denormalized from the profile at write time for simple querying/RLS without an extra join. event_id is device/client-supplied and unique per device -- an offline-buffered scan retried on reconnect resolves to the same row, never a duplicate.';

create index idx_biometric_events_school_at on public.biometric_events(school_id, occurred_at desc);
create index idx_biometric_events_person on public.biometric_events(person_type, person_id, occurred_at desc);

alter table public.biometric_events enable row level security;

create policy biometric_events_select on public.biometric_events
  for select
  using (
    auth_is_super_admin()
    or ((school_id = auth_school_id()) and auth_has_permission('biometric.events_read'))
    or (person_type = 'student' and auth_user_id_is_guardian_of(person_id))
  );

-- ============================================================
-- 8. Wire into the EXISTING attendance module: a new session value on
--    student_attendance, same mechanism boarding roll call already uses.
-- ============================================================
alter table public.student_attendance drop constraint student_attendance_session_check;
alter table public.student_attendance add constraint student_attendance_session_check
  check (session = any (array['class','boarding_am','boarding_pm','gate']));

-- Traceability from staff_attendance back to the biometric event that
-- created/updated it, without adding a status/session concept staff
-- attendance doesn't have. Nullable -- purely additive, existing manual
-- marking flow (marked_by, edit_reason) is completely unaffected.
alter table public.staff_attendance
  add column biometric_event_id uuid references public.biometric_events(id);
