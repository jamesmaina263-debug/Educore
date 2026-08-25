-- Support for push-protocol devices (ZKTeco ADMS and similar), which
-- authenticate very differently from the bearer-token model biometric-verify
-- uses. A push device's on-device menu typically only lets you configure a
-- server host/port -- not a custom Authorization header -- so there is no
-- way to hand it a "bio_xxx.secret" bearer token. What these devices DO
-- commonly support is a "Comm Key" / "Communication Password" configured
-- in their own menu and echoed back as a query-string parameter on every
-- request. That is weaker than a bearer header (it can end up in server
-- access logs, and it travels in the URL rather than a header), which is
-- why this is a SEPARATE, explicitly weaker, opt-in auth path scoped only
-- to push-protocol devices -- not a replacement for api_key_hash, which
-- keeps working exactly as before for anything that can hold a real bearer
-- token (the kiosk, any future provider with a real HTTP client).
alter table public.biometric_devices add column if not exists comm_key text;
comment on column public.biometric_devices.comm_key is
  'Shared secret for push-protocol providers (ZKTeco ADMS "Comm Key" and similar) that cannot send a bearer Authorization header. Weaker than api_key_hash -- travels as a URL query parameter, not a header -- so only used by the push-provider ingestion endpoint, never by biometric-verify''s bearer-token path. Null is valid (some devices/firmwares don''t support a comm key at all); when null, authentication rests on the device serial number alone, which is why registering the correct serial_number on the biometric_devices row matters.';

-- A push device can tell us "PIN 1042 / Name 'Ethan M' was just enrolled or
-- changed on the device" (see ADMS's OPERLOG/USER pushes), but a raw PIN +
-- typed name is not something safe to auto-link to a specific EduCore
-- student or staff record -- names collide, and getting this wrong would
-- silently attach one person's attendance to a different person's record.
-- So a push provider's enrollment signal lands here as a staged, unlinked
-- event; a human with biometric.enroll reviews it and picks the real
-- profile it belongs to (see link action), which is what actually creates
-- the biometric_credentials row. This table itself never contains anything
-- biometric -- only the device-local PIN and whatever display name string
-- the device sent, both already opaque/non-biometric by the same rule
-- every other biometric table follows.
create table public.biometric_enrollment_events (
  id uuid primary key default gen_random_uuid(),
  school_id uuid not null references public.schools(id),
  device_id uuid not null references public.biometric_devices(id) on delete cascade,
  provider_user_id text not null,
  provider_user_name text,
  raw_payload jsonb not null default '{}'::jsonb,
  status text not null default 'pending' check (status = any (array['pending','linked','ignored'])),
  linked_credential_id uuid references public.biometric_credentials(id),
  linked_by uuid references public.school_users(id),
  linked_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (device_id, provider_user_id, status) -- one live pending row per device+PIN; re-pushes update it instead of piling up duplicates
);
comment on table public.biometric_enrollment_events is
  'Staged, human-reviewed enrollment signals pushed by a provider device (e.g. ZKTeco ADMS OPERLOG/USER push) before any biometric_credentials row is created. Never auto-linked -- see link_biometric_enrollment_event.';

create trigger trg_biometric_enrollment_events_updated_at
  before update on public.biometric_enrollment_events
  for each row execute function public.set_updated_at();

create index idx_biometric_enrollment_events_pending on public.biometric_enrollment_events(school_id, status) where status = 'pending';

alter table public.biometric_enrollment_events enable row level security;

create policy biometric_enrollment_events_select on public.biometric_enrollment_events
  for select
  using (auth_is_super_admin() or ((school_id = auth_school_id()) and (auth_has_permission('biometric.view') or auth_has_permission('biometric.enroll'))));

-- Linking (status pending -> linked/ignored) is an ordinary authenticated
-- staff action scoped to their own school -- unlike the device-key RPCs
-- elsewhere in this module, it doesn't need SECURITY DEFINER, since RLS
-- alone already expresses the right rule (biometric.enroll, same school).
create policy biometric_enrollment_events_update on public.biometric_enrollment_events
  for update
  using (auth_is_super_admin() or ((school_id = auth_school_id()) and auth_has_permission('biometric.enroll')))
  with check (auth_is_super_admin() or ((school_id = auth_school_id()) and auth_has_permission('biometric.enroll')));

-- No client insert policy: rows are only ever created by the service-role
-- push-ingestion function, matching biometric_events' own "immutable audit
-- trail written only by the trusted ingestion path" stance.
