-- WP 5.1 (1/2): vehicle position tables + ingestion function. Additive only, dark behind
-- feature.transport.live_tracking (enabled for nobody). Existing transport tables are untouched.
-- Location of school vehicles is child-safety data: read access is role-limited
-- (transport.read_any of the own school), devices authenticate with a token that is stored only as
-- a SHA-256 hash, and a retention purge function exists (not scheduled here).

-- 1. Flag catalog entry.
insert into public.platform_feature_flags (key, label, description)
select 'feature.transport.live_tracking',
       'Vehicle live tracking',
       'Lets a school register GPS tracker devices (e.g. the driver phone app) per vehicle and store their positions. Off by default.'
where not exists (select 1 from public.platform_feature_flags where lower(key) = 'feature.transport.live_tracking');

-- 2. Tracker devices. Token is shown once at creation; only its hash is stored.
create table if not exists public.vehicle_tracker_devices (
  id uuid primary key default gen_random_uuid(),
  school_id uuid not null references public.schools(id) on delete cascade,
  vehicle_id uuid not null references public.transport_vehicles(id) on delete cascade,
  label text not null check (char_length(label) between 1 and 80),
  token_hash text not null unique,
  active boolean not null default true,
  created_by uuid references public.school_users(id),
  created_at timestamptz not null default now(),
  last_seen_at timestamptz,
  revoked_at timestamptz
);
create index if not exists idx_vehicle_tracker_devices_vehicle on public.vehicle_tracker_devices (school_id, vehicle_id);

alter table public.vehicle_tracker_devices enable row level security;
create policy vehicle_tracker_devices_select on public.vehicle_tracker_devices
  for select using (
    public.auth_is_super_admin()
    or (school_id = public.auth_school_id() and public.auth_has_permission('transport.write'))
  );
-- No insert/update/delete policies: writes go through the SECURITY DEFINER functions below.
revoke all on table public.vehicle_tracker_devices from anon, authenticated;
grant select (id, school_id, vehicle_id, label, active, created_by, created_at, last_seen_at, revoked_at)
  on public.vehicle_tracker_devices to authenticated;

-- 3. Positions.
create table if not exists public.vehicle_positions (
  id bigint generated always as identity primary key,
  school_id uuid not null references public.schools(id) on delete cascade,
  vehicle_id uuid not null references public.transport_vehicles(id) on delete cascade,
  device_id uuid not null references public.vehicle_tracker_devices(id) on delete cascade,
  recorded_at timestamptz not null,
  received_at timestamptz not null default now(),
  lat double precision not null check (lat between -90 and 90),
  lng double precision not null check (lng between -180 and 180),
  speed_kph real check (speed_kph is null or (speed_kph >= 0 and speed_kph <= 300)),
  heading real check (heading is null or (heading >= 0 and heading <= 360)),
  accuracy_m real check (accuracy_m is null or accuracy_m >= 0),
  unique (device_id, recorded_at)
);
create index if not exists idx_vehicle_positions_vehicle_time on public.vehicle_positions (school_id, vehicle_id, recorded_at desc);
create index if not exists idx_vehicle_positions_recorded_at on public.vehicle_positions (recorded_at);

alter table public.vehicle_positions enable row level security;
create policy vehicle_positions_select on public.vehicle_positions
  for select using (
    public.auth_is_super_admin()
    or (school_id = public.auth_school_id() and public.auth_has_permission('transport.read_any'))
  );
revoke all on table public.vehicle_positions from anon, authenticated;
grant select on public.vehicle_positions to authenticated;

create or replace view public.v_vehicle_latest_position with (security_invoker = true) as
select distinct on (vehicle_id)
  vehicle_id, school_id, device_id, recorded_at, received_at, lat, lng, speed_kph, heading, accuracy_m
from public.vehicle_positions
order by vehicle_id, recorded_at desc;
revoke all on public.v_vehicle_latest_position from anon, authenticated;
grant select on public.v_vehicle_latest_position to authenticated;

-- 4. Create a device (returns the token ONCE). transport.write of the own school, flag on.
create or replace function public.create_tracker_device(p_vehicle_id uuid, p_label text)
returns table (device_id uuid, token text)
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_school uuid := public.auth_school_id();
  v_actor uuid;
  v_token text;
  v_id uuid;
begin
  if v_school is null or not public.auth_has_permission('transport.write') then
    raise exception 'Not authorized to manage tracker devices.' using errcode = '42501';
  end if;
  if not public.school_has_feature_flag(v_school, 'feature.transport.live_tracking') then
    raise exception 'Vehicle live tracking is not enabled for this school.' using errcode = '42501';
  end if;
  if p_label is null or char_length(btrim(p_label)) not between 1 and 80 then
    raise exception 'Label must be 1 to 80 characters.' using errcode = '22023';
  end if;
  if not exists (select 1 from public.transport_vehicles where id = p_vehicle_id and school_id = v_school) then
    raise exception 'Vehicle not found in your school.' using errcode = 'P0002';
  end if;
  if (select count(*) from public.vehicle_tracker_devices
        where vehicle_id = p_vehicle_id and active) >= 5 then
    raise exception 'This vehicle already has 5 active tracker devices. Revoke one first.' using errcode = '54000';
  end if;

  select su.id into v_actor from public.school_users su
    where su.auth_user_id = auth.uid() and su.school_id = v_school and su.status = 'active' limit 1;

  v_token := 'vt_' || replace(gen_random_uuid()::text || gen_random_uuid()::text, '-', '');
  insert into public.vehicle_tracker_devices (school_id, vehicle_id, label, token_hash, created_by)
  values (v_school, p_vehicle_id, btrim(p_label), encode(sha256(convert_to(v_token, 'UTF8')), 'hex'), v_actor)
  returning id into v_id;

  insert into public.audit_log (school_id, actor_school_user_id, table_name, record_id, action, new_data)
  values (v_school, v_actor, 'vehicle_tracker_devices', v_id, 'tracker_device_created',
          jsonb_build_object('vehicle_id', p_vehicle_id, 'label', btrim(p_label), 'actor_auth_user_id', auth.uid()));

  return query select v_id, v_token;
end;
$function$;

-- 5. Revoke a device.
create or replace function public.revoke_tracker_device(p_device_id uuid)
returns void
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_school uuid := public.auth_school_id();
  v_actor uuid;
  v_changed boolean;
begin
  if v_school is null or not public.auth_has_permission('transport.write') then
    raise exception 'Not authorized to manage tracker devices.' using errcode = '42501';
  end if;
  update public.vehicle_tracker_devices
     set active = false, revoked_at = now()
   where id = p_device_id and school_id = v_school and active;
  v_changed := found;
  if not v_changed then
    if not exists (select 1 from public.vehicle_tracker_devices where id = p_device_id and school_id = v_school) then
      raise exception 'Device not found in your school.' using errcode = 'P0002';
    end if;
    return; -- already revoked: no-op, not audited
  end if;
  select su.id into v_actor from public.school_users su
    where su.auth_user_id = auth.uid() and su.school_id = v_school and su.status = 'active' limit 1;
  insert into public.audit_log (school_id, actor_school_user_id, table_name, record_id, action, new_data)
  values (v_school, v_actor, 'vehicle_tracker_devices', p_device_id, 'tracker_device_revoked',
          jsonb_build_object('actor_auth_user_id', auth.uid()));
end;
$function$;

-- 6. Ingestion (service role only; called by the vehicle-position-ingest edge function).
-- p_points: jsonb array, max 100 items, each {t, lat, lng, speed_kph?, heading?, accuracy_m?}
-- (t = ISO-8601 time). Bad points are counted as rejected; they never fail the batch.
create or replace function public.ingest_vehicle_positions(p_token_hash text, p_points jsonb)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_dev public.vehicle_tracker_devices%rowtype;
  v_pt jsonb;
  v_t timestamptz;
  v_lat double precision;
  v_lng double precision;
  v_accepted integer := 0;
  v_rejected integer := 0;
  v_dupes integer := 0;
  v_rows integer;
begin
  select * into v_dev from public.vehicle_tracker_devices where token_hash = p_token_hash and active;
  if not found then
    return jsonb_build_object('status', 'invalid');
  end if;
  if not public.school_has_feature_flag(v_dev.school_id, 'feature.transport.live_tracking') then
    return jsonb_build_object('status', 'disabled');
  end if;
  if p_points is null or jsonb_typeof(p_points) <> 'array' or jsonb_array_length(p_points) not between 1 and 100 then
    return jsonb_build_object('status', 'bad_request');
  end if;

  for v_pt in select * from jsonb_array_elements(p_points) loop
    begin
      v_t := (v_pt->>'t')::timestamptz;
      v_lat := (v_pt->>'lat')::double precision;
      v_lng := (v_pt->>'lng')::double precision;
      if v_t is null or v_lat is null or v_lng is null
         or v_t > now() + interval '5 minutes' or v_t < now() - interval '48 hours' then
        v_rejected := v_rejected + 1;
        continue;
      end if;
      insert into public.vehicle_positions (school_id, vehicle_id, device_id, recorded_at, lat, lng, speed_kph, heading, accuracy_m)
      values (v_dev.school_id, v_dev.vehicle_id, v_dev.id, v_t, v_lat, v_lng,
              nullif(v_pt->>'speed_kph', '')::real, nullif(v_pt->>'heading', '')::real, nullif(v_pt->>'accuracy_m', '')::real)
      on conflict (device_id, recorded_at) do nothing;
      get diagnostics v_rows = row_count;
      if v_rows = 1 then v_accepted := v_accepted + 1; else v_dupes := v_dupes + 1; end if;
    exception when others then
      v_rejected := v_rejected + 1;
    end;
  end loop;

  update public.vehicle_tracker_devices set last_seen_at = now() where id = v_dev.id;
  return jsonb_build_object('status', 'ok', 'accepted', v_accepted, 'duplicates', v_dupes, 'rejected', v_rejected);
end;
$function$;

-- 7. Retention purge (service role only; NOT scheduled by this migration). Minimum 7 days.
create or replace function public.purge_vehicle_positions(p_keep_days integer default 30)
returns integer
language plpgsql
security definer
set search_path to 'public'
as $function$
declare v_n integer;
begin
  if p_keep_days is null or p_keep_days < 7 then
    raise exception 'Retention must be at least 7 days.' using errcode = '22023';
  end if;
  delete from public.vehicle_positions where recorded_at < now() - make_interval(days => p_keep_days);
  get diagnostics v_n = row_count;
  return v_n;
end;
$function$;

revoke all on function public.create_tracker_device(uuid, text) from public;
revoke execute on function public.create_tracker_device(uuid, text) from anon;
grant execute on function public.create_tracker_device(uuid, text) to authenticated;

revoke all on function public.revoke_tracker_device(uuid) from public;
revoke execute on function public.revoke_tracker_device(uuid) from anon;
grant execute on function public.revoke_tracker_device(uuid) to authenticated;

revoke all on function public.ingest_vehicle_positions(text, jsonb) from public, anon, authenticated;
grant execute on function public.ingest_vehicle_positions(text, jsonb) to service_role;

revoke all on function public.purge_vehicle_positions(integer) from public, anon, authenticated;
grant execute on function public.purge_vehicle_positions(integer) to service_role;
