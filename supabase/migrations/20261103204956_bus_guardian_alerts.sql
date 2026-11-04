-- WP 5.4 + 5.5 (1/3): guardian bus alerts and bus roll-call boarding, database core. Additive only; ships dark.
--
-- Interpretation (flagged for the user): "boarding" here means the school BUS (Phase 5 is Transport). The existing
-- boarding-school roll-call (student_attendance sessions boarding_am / boarding_pm) is a different module and is
-- not touched.
--
-- * New flag feature.transport.guardian_alerts (catalog entry, enabled for nobody).
-- * Every alert is triggered by a person: staff send a delay alert, or staff record a bus roll-call boarding /
--   drop-off. Nothing is sent automatically, and gate scans NEVER send anything from here (gate scans already text
--   guardians through biometric-verify, so re-sending would double-message parents). Gate scans are only compared
--   with bus roll-call in bus_boarding_reconciliation(), a read-only check.
-- * Per-school mode, enforced in the database: 'off' (default) sends nothing; 'test' sends ONE message per action
--   to a single staff test phone and never to a guardian; 'live' messages guardians. 'live' cannot be selected until
--   a test alert has been queued to the current test phone (table constraint + function check).
-- * Messages are queued as notification_logs rows (SMS only, source_module 'bus_alert') exactly like fee reminders
--   (send_fee_reminder); the existing send-communication function delivers them. No new SMS code, no WhatsApp.
-- * Guardians can opt out of bus alerts (new table bus_alert_preferences: notification_preferences has a fixed
--   category list, and changing that constraint would edit an existing object). Opt-out, missing phone and quiet
--   hours (20:00-05:00 Africa/Nairobi) are checked at send time and recorded as skips.
-- * RLS on every table; NO direct write policies; every change goes through the SECURITY DEFINER functions below.
-- * Nothing existing is touched. Payments, C2B and WhatsApp are untouched.
-- Rollback: set the school's mode to off or switch the flag off. Nothing else depends on these objects.

-- 1. Flag catalog entry.
insert into public.platform_feature_flags (key, label, description)
select 'feature.transport.guardian_alerts',
       'Guardian bus alerts',
       'Staff send bus delay alerts and record bus roll-call boarding; guardians get SMS (test phone first). Off by default.'
where not exists (
  select 1 from public.platform_feature_flags where lower(key) = 'feature.transport.guardian_alerts'
);

-- 2. Per-school settings. One row per school; no row = mode off.
create table if not exists public.bus_alert_settings (
  school_id uuid primary key references public.schools(id) on delete cascade,
  mode text not null default 'off' check (mode in ('off', 'test', 'live')),
  test_phone text check (test_phone is null or test_phone ~ '^\+?[0-9]{9,15}$'),
  test_sent_at timestamptz,
  quiet_start time not null default '20:00',
  quiet_end time not null default '05:00',
  updated_by uuid references public.school_users(id) on delete set null,
  updated_at timestamptz not null default now(),
  constraint bus_alert_active_needs_phone check (mode = 'off' or test_phone is not null),
  constraint bus_alert_live_needs_test check (mode <> 'live' or (test_phone is not null and test_sent_at is not null))
);
comment on table public.bus_alert_settings is
  'Per-school bus alert mode (off/test/live) and staff test phone. live requires a test alert queued to the current test phone. Written only by set_bus_alert_mode() / send_bus_test_alert().';
alter table public.bus_alert_settings enable row level security;
drop policy if exists bus_alert_settings_select on public.bus_alert_settings;
create policy bus_alert_settings_select on public.bus_alert_settings for select
  using (
    auth_is_super_admin()
    or (
      school_id = auth_school_id()
      and public.my_school_has_feature_flag('feature.transport.guardian_alerts')
      and auth_has_permission('transport.read_any')
    )
  );

-- 3. Guardian opt-out. A row with enabled = false means opted out; no row means opted in.
create table if not exists public.bus_alert_preferences (
  school_user_id uuid primary key references public.school_users(id) on delete cascade,
  school_id uuid not null references public.schools(id) on delete cascade,
  enabled boolean not null,
  updated_at timestamptz not null default now()
);
comment on table public.bus_alert_preferences is
  'Guardian choice to receive bus alerts. Written only by set_my_bus_alerts().';
alter table public.bus_alert_preferences enable row level security;
drop policy if exists bus_alert_preferences_select on public.bus_alert_preferences;
create policy bus_alert_preferences_select on public.bus_alert_preferences for select
  using (
    auth_is_super_admin()
    or (
      public.my_school_has_feature_flag('feature.transport.guardian_alerts')
      and (
        school_user_id = auth_school_user_id()
        or (school_id = auth_school_id() and auth_has_permission('transport.read_any'))
      )
    )
  );

-- 4. Bus roll-call boarding events (append-only: no update/delete policy).
create table if not exists public.bus_boarding_events (
  id uuid primary key default gen_random_uuid(),
  school_id uuid not null references public.schools(id) on delete cascade,
  student_id uuid not null references public.students(id),
  route_id uuid not null references public.transport_routes(id),
  vehicle_id uuid references public.transport_vehicles(id),
  kind text not null check (kind in ('boarded', 'dropped_off')),
  occurred_at timestamptz not null default now(),
  recorded_by uuid references public.school_users(id) on delete set null,
  created_at timestamptz not null default now()
);
comment on table public.bus_boarding_events is
  'Bus roll-call: a learner boarded or got off the bus. Append-only. Written only by record_bus_boarding().';
create index if not exists bus_boarding_events_school_time on public.bus_boarding_events (school_id, occurred_at desc);
create index if not exists bus_boarding_events_student_time on public.bus_boarding_events (student_id, occurred_at desc);
alter table public.bus_boarding_events enable row level security;
drop policy if exists bus_boarding_events_select on public.bus_boarding_events;
create policy bus_boarding_events_select on public.bus_boarding_events for select
  using (
    auth_is_super_admin()
    or (
      school_id = auth_school_id()
      and public.my_school_has_feature_flag('feature.transport.guardian_alerts')
      and auth_has_permission('transport.read_any')
    )
  );

-- 5. Log of what each action did (queued, or why it was skipped). Append-only.
create table if not exists public.bus_alerts (
  id uuid primary key default gen_random_uuid(),
  school_id uuid not null references public.schools(id) on delete cascade,
  kind text not null check (kind in ('delay', 'boarded', 'dropped_off', 'test')),
  mode text not null check (mode in ('test', 'live')),
  student_id uuid references public.students(id),
  route_id uuid references public.transport_routes(id),
  boarding_event_id uuid references public.bus_boarding_events(id),
  guardian_user_id uuid references public.school_users(id) on delete set null,
  notification_log_id uuid references public.notification_logs(id) on delete set null,
  outcome text not null check (outcome in ('queued', 'skipped_opt_out', 'skipped_no_phone', 'skipped_quiet_hours')),
  created_by uuid references public.school_users(id) on delete set null,
  created_at timestamptz not null default now()
);
comment on table public.bus_alerts is
  'What each bus alert action queued or skipped. Append-only. Written only by the bus alert functions.';
create index if not exists bus_alerts_school_time on public.bus_alerts (school_id, created_at desc);
create index if not exists bus_alerts_route_kind_time on public.bus_alerts (route_id, kind, created_at desc);
alter table public.bus_alerts enable row level security;
drop policy if exists bus_alerts_select on public.bus_alerts;
create policy bus_alerts_select on public.bus_alerts for select
  using (
    auth_is_super_admin()
    or (
      school_id = auth_school_id()
      and public.my_school_has_feature_flag('feature.transport.guardian_alerts')
      and auth_has_permission('transport.read_any')
    )
  );

-- 6. Internal: is "now" inside the school's quiet hours (Africa/Nairobi)? Not callable by clients.
create or replace function public.bus_alert_in_quiet_hours(p_start time, p_end time)
returns boolean
language sql
stable
set search_path to 'public'
as $$
  select case
    when p_start = p_end then false
    when p_start < p_end then (now() at time zone 'Africa/Nairobi')::time >= p_start and (now() at time zone 'Africa/Nairobi')::time < p_end
    else (now() at time zone 'Africa/Nairobi')::time >= p_start or (now() at time zone 'Africa/Nairobi')::time < p_end
  end;
$$;
revoke all on function public.bus_alert_in_quiet_hours(time, time) from public, anon, authenticated;

-- 7. Internal: queue one SMS to a recipient via the existing notification_logs path.
create or replace function public.bus_alert_queue_sms(
  p_school uuid,
  p_student uuid,
  p_recipient_user uuid,
  p_recipient_type text,
  p_phone text,
  p_body text,
  p_sent_by uuid
) returns uuid
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_log uuid;
begin
  insert into public.notification_logs (
    school_id, student_id, recipient_school_user_id, recipient_phone, recipient_type, channel, body,
    segments, sent_by, source_module
  ) values (
    p_school, p_student, p_recipient_user, p_phone, p_recipient_type, 'sms', p_body,
    greatest(1, ceil(length(p_body)::numeric / 160))::smallint, p_sent_by, 'bus_alert'
  ) returning id into v_log;
  return v_log;
end;
$$;
revoke all on function public.bus_alert_queue_sms(uuid, uuid, uuid, text, text, text, uuid) from public, anon, authenticated;

-- 8. Internal: deliver one alert for a set of guardians according to the school's mode.
--    p_guardians is a jsonb array of {"id": uuid, "phone": text, "student_id": uuid|null}.
--    Returns counts. test mode: ONE message to the staff test phone, none to guardians.
create or replace function public.bus_alert_deliver(
  p_school uuid,
  p_kind text,
  p_route uuid,
  p_event uuid,
  p_student uuid,
  p_body text,
  p_guardians jsonb,
  p_caller uuid
) returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_set public.bus_alert_settings%rowtype;
  v_quiet boolean;
  v_g jsonb;
  v_n int := jsonb_array_length(coalesce(p_guardians, '[]'::jsonb));
  v_log uuid;
  v_queued int := 0;
  v_opt int := 0;
  v_nophone int := 0;
  v_quietskip int := 0;
  v_gid uuid;
  v_phone text;
begin
  select * into v_set from public.bus_alert_settings where school_id = p_school;
  if not found or v_set.mode = 'off' then
    return jsonb_build_object('mode', 'off', 'guardians', v_n, 'queued', 0);
  end if;

  if v_set.mode = 'test' then
    -- Never a guardian. One sample message to the staff test phone, saying how many would have been reached.
    v_log := public.bus_alert_queue_sms(
      p_school, null, p_caller, 'staff', v_set.test_phone,
      '[TEST] ' || p_body || ' (live mode would reach ' || v_n || ' guardian' || case when v_n = 1 then '' else 's' end || ')',
      p_caller);
    insert into public.bus_alerts (school_id, kind, mode, student_id, route_id, boarding_event_id, notification_log_id, outcome, created_by)
    values (p_school, p_kind, 'test', p_student, p_route, p_event, v_log, 'queued', p_caller);
    return jsonb_build_object('mode', 'test', 'guardians', v_n, 'queued', 1);
  end if;

  -- live
  v_quiet := public.bus_alert_in_quiet_hours(v_set.quiet_start, v_set.quiet_end);
  for v_g in select value from jsonb_array_elements(coalesce(p_guardians, '[]'::jsonb)) loop
    v_gid := (v_g ->> 'id')::uuid;
    v_phone := nullif(btrim(coalesce(v_g ->> 'phone', '')), '');
    if v_quiet then
      v_quietskip := v_quietskip + 1;
      insert into public.bus_alerts (school_id, kind, mode, student_id, route_id, boarding_event_id, guardian_user_id, outcome, created_by)
      values (p_school, p_kind, 'live', nullif(v_g ->> 'student_id', '')::uuid, p_route, p_event, v_gid, 'skipped_quiet_hours', p_caller);
    elsif coalesce((select bp.enabled from public.bus_alert_preferences bp where bp.school_user_id = v_gid), true) = false then
      v_opt := v_opt + 1;
      insert into public.bus_alerts (school_id, kind, mode, student_id, route_id, boarding_event_id, guardian_user_id, outcome, created_by)
      values (p_school, p_kind, 'live', nullif(v_g ->> 'student_id', '')::uuid, p_route, p_event, v_gid, 'skipped_opt_out', p_caller);
    elsif v_phone is null then
      v_nophone := v_nophone + 1;
      insert into public.bus_alerts (school_id, kind, mode, student_id, route_id, boarding_event_id, guardian_user_id, outcome, created_by)
      values (p_school, p_kind, 'live', nullif(v_g ->> 'student_id', '')::uuid, p_route, p_event, v_gid, 'skipped_no_phone', p_caller);
    else
      v_log := public.bus_alert_queue_sms(p_school, nullif(v_g ->> 'student_id', '')::uuid, v_gid, 'guardian', v_phone, p_body, p_caller);
      v_queued := v_queued + 1;
      insert into public.bus_alerts (school_id, kind, mode, student_id, route_id, boarding_event_id, guardian_user_id, notification_log_id, outcome, created_by)
      values (p_school, p_kind, 'live', nullif(v_g ->> 'student_id', '')::uuid, p_route, p_event, v_gid, v_log, 'queued', p_caller);
    end if;
  end loop;
  return jsonb_build_object('mode', 'live', 'guardians', v_n, 'queued', v_queued,
                            'skipped_opt_out', v_opt, 'skipped_no_phone', v_nophone, 'skipped_quiet_hours', v_quietskip);
end;
$$;
revoke all on function public.bus_alert_deliver(uuid, text, uuid, uuid, uuid, text, jsonb, uuid) from public, anon, authenticated;

-- 9. Set the mode and test phone. 'live' needs a test alert already queued to the current test phone.
create or replace function public.set_bus_alert_mode(p_mode text, p_test_phone text)
returns void
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_school uuid := auth_school_id();
  v_me uuid := auth_school_user_id();
  v_phone text := nullif(regexp_replace(coalesce(p_test_phone, ''), '[[:space:]-]', '', 'g'), '');
  v_cur_phone text;
  v_cur_tested timestamptz;
begin
  if v_school is null or not auth_has_permission('transport.write') then
    raise exception 'Not authorized to change bus alert settings.' using errcode = '42501';
  end if;
  if not public.school_has_feature_flag(v_school, 'feature.transport.guardian_alerts') then
    raise exception 'Guardian bus alerts are not enabled for this school.' using errcode = '55000';
  end if;
  if p_mode is null or p_mode not in ('off', 'test', 'live') then
    raise exception 'Invalid mode.' using errcode = '22023';
  end if;
  if v_phone is not null and v_phone !~ '^\+?[0-9]{9,15}$' then
    raise exception 'The test phone number is not valid.' using errcode = '22023';
  end if;

  select s.test_phone, s.test_sent_at into v_cur_phone, v_cur_tested
    from public.bus_alert_settings s where s.school_id = v_school;

  -- A new test phone has not been tested yet.
  if v_phone is not null and v_phone is distinct from v_cur_phone then
    v_cur_phone := v_phone;
    v_cur_tested := null;
  end if;
  if p_mode in ('test', 'live') and v_cur_phone is null then
    raise exception 'Set a staff test phone number first.' using errcode = '22023';
  end if;
  if p_mode = 'live' and v_cur_tested is null then
    raise exception 'Send a test alert to the test phone before switching to live.' using errcode = '22023';
  end if;

  insert into public.bus_alert_settings (school_id, mode, test_phone, test_sent_at, updated_by, updated_at)
  values (v_school, p_mode, v_cur_phone, v_cur_tested, v_me, now())
  on conflict (school_id) do update
    set mode = excluded.mode, test_phone = excluded.test_phone, test_sent_at = excluded.test_sent_at,
        updated_by = excluded.updated_by, updated_at = excluded.updated_at;
end;
$$;
revoke all on function public.set_bus_alert_mode(text, text) from public, anon;
grant execute on function public.set_bus_alert_mode(text, text) to authenticated;

-- 10. Queue one sample message to the staff test phone. Marks the test phone as tested.
create or replace function public.send_bus_test_alert()
returns uuid
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_school uuid := auth_school_id();
  v_me uuid := auth_school_user_id();
  v_set public.bus_alert_settings%rowtype;
  v_school_name text;
  v_log uuid;
begin
  if v_school is null or not auth_has_permission('transport.write') then
    raise exception 'Not authorized to send a test bus alert.' using errcode = '42501';
  end if;
  if not public.school_has_feature_flag(v_school, 'feature.transport.guardian_alerts') then
    raise exception 'Guardian bus alerts are not enabled for this school.' using errcode = '55000';
  end if;
  select * into v_set from public.bus_alert_settings where school_id = v_school;
  if not found or v_set.test_phone is null or v_set.mode = 'off' then
    raise exception 'Set a staff test phone and switch to test mode first.' using errcode = '22023';
  end if;
  select name into v_school_name from public.schools where id = v_school;
  v_log := public.bus_alert_queue_sms(
    v_school, null, v_me, 'staff', v_set.test_phone,
    '[TEST] ' || coalesce(v_school_name, 'School') || ': this is a sample bus alert. If you can read this, bus alerts can reach your test phone.',
    v_me);
  insert into public.bus_alerts (school_id, kind, mode, notification_log_id, outcome, created_by)
  values (v_school, 'test', 'test', v_log, 'queued', v_me);
  update public.bus_alert_settings set test_sent_at = now(), updated_by = v_me, updated_at = now() where school_id = v_school;
  return v_log;
end;
$$;
revoke all on function public.send_bus_test_alert() from public, anon;
grant execute on function public.send_bus_test_alert() to authenticated;

-- 11. Delay alert for everyone riding a route. Staff action. Refuses a repeat for the same route within 10 minutes.
create or replace function public.send_bus_delay_alert(p_route_id uuid, p_minutes integer, p_note text)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_school uuid := auth_school_id();
  v_me uuid := auth_school_user_id();
  v_set public.bus_alert_settings%rowtype;
  v_route text;
  v_school_name text;
  v_note text := nullif(btrim(coalesce(p_note, '')), '');
  v_guardians jsonb;
  v_body text;
begin
  if v_school is null or not auth_has_permission('transport.write') then
    raise exception 'Not authorized to send bus alerts.' using errcode = '42501';
  end if;
  if not public.school_has_feature_flag(v_school, 'feature.transport.guardian_alerts') then
    raise exception 'Guardian bus alerts are not enabled for this school.' using errcode = '55000';
  end if;
  select * into v_set from public.bus_alert_settings where school_id = v_school;
  if not found or v_set.mode = 'off' then
    raise exception 'Bus alerts are switched off for this school.' using errcode = '55000';
  end if;
  if p_minutes is null or p_minutes not between 5 and 180 then
    raise exception 'Delay must be between 5 and 180 minutes.' using errcode = '22023';
  end if;
  if v_note is not null and (char_length(v_note) > 120 or v_note ~ '[[:cntrl:]]') then
    raise exception 'The note must be 120 characters or fewer, with no line breaks.' using errcode = '22023';
  end if;
  select name into v_route from public.transport_routes where id = p_route_id and school_id = v_school;
  if v_route is null then
    raise exception 'Route not found.' using errcode = 'P0002';
  end if;
  if exists (
    select 1 from public.bus_alerts
     where school_id = v_school and route_id = p_route_id and kind = 'delay' and created_at > now() - interval '10 minutes'
  ) then
    raise exception 'A delay alert for this route was already sent in the last 10 minutes.' using errcode = 'P0001';
  end if;

  select coalesce(jsonb_agg(jsonb_build_object('id', g.id, 'phone', g.phone, 'student_id', null)), '[]'::jsonb)
    into v_guardians
    from (
      select distinct su.id, su.phone
        from public.student_transport_assignments a
        join public.students st on st.id = a.student_id and st.school_id = v_school and st.status not in ('withdrawn', 'transferred', 'graduated')
        join public.student_guardians sg on sg.student_id = st.id
        join public.school_users su on su.id = sg.guardian_user_id and su.school_id = v_school
       where a.school_id = v_school and a.route_id = p_route_id and a.status = 'active'
         and (a.end_date is null or a.end_date >= (now() at time zone 'Africa/Nairobi')::date)
    ) g;

  select name into v_school_name from public.schools where id = v_school;
  v_body := coalesce(v_school_name, 'School') || ': the ' || v_route || ' bus is running about ' || p_minutes || ' minutes late.'
            || case when v_note is not null then ' ' || v_note else '' end;
  return public.bus_alert_deliver(v_school, 'delay', p_route_id, null, null, v_body, v_guardians, v_me);
end;
$$;
revoke all on function public.send_bus_delay_alert(uuid, integer, text) from public, anon;
grant execute on function public.send_bus_delay_alert(uuid, integer, text) to authenticated;

-- 12. Bus roll-call: record that a learner boarded or got off the bus, and alert their guardians per the mode.
--     Records the event whenever the flag is on (even with alerts off); refuses a repeat within 10 minutes.
create or replace function public.record_bus_boarding(p_student_id uuid, p_kind text, p_vehicle_id uuid default null)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_school uuid := auth_school_id();
  v_me uuid := auth_school_user_id();
  v_route uuid;
  v_asg_vehicle uuid;
  v_vehicle uuid;
  v_event uuid;
  v_first text;
  v_school_name text;
  v_guardians jsonb;
  v_body text;
  v_time text := to_char(now() at time zone 'Africa/Nairobi', 'HH24:MI');
  v_result jsonb;
begin
  if v_school is null or not auth_has_permission('transport.write') then
    raise exception 'Not authorized to record bus boarding.' using errcode = '42501';
  end if;
  if not public.school_has_feature_flag(v_school, 'feature.transport.guardian_alerts') then
    raise exception 'Guardian bus alerts are not enabled for this school.' using errcode = '55000';
  end if;
  if p_kind is null or p_kind not in ('boarded', 'dropped_off') then
    raise exception 'Invalid boarding event.' using errcode = '22023';
  end if;
  select st.first_name into v_first from public.students st
   where st.id = p_student_id and st.school_id = v_school and st.status not in ('withdrawn', 'transferred', 'graduated');
  if v_first is null then
    raise exception 'Learner not found.' using errcode = 'P0002';
  end if;
  select a.route_id, a.vehicle_id into v_route, v_asg_vehicle from public.student_transport_assignments a
   where a.student_id = p_student_id and a.school_id = v_school and a.status = 'active'
     and (a.end_date is null or a.end_date >= (now() at time zone 'Africa/Nairobi')::date)
   order by a.start_date desc limit 1;
  if v_route is null then
    raise exception 'This learner has no active transport assignment.' using errcode = 'P0002';
  end if;
  v_vehicle := coalesce(p_vehicle_id, v_asg_vehicle);
  if v_vehicle is not null and not exists (select 1 from public.transport_vehicles where id = v_vehicle and school_id = v_school) then
    raise exception 'Vehicle not found.' using errcode = 'P0002';
  end if;
  if exists (
    select 1 from public.bus_boarding_events
     where student_id = p_student_id and kind = p_kind and occurred_at > now() - interval '10 minutes'
  ) then
    raise exception 'This was already recorded in the last 10 minutes.' using errcode = 'P0001';
  end if;

  insert into public.bus_boarding_events (school_id, student_id, route_id, vehicle_id, kind, recorded_by)
  values (v_school, p_student_id, v_route, v_vehicle, p_kind, v_me)
  returning id into v_event;

  select coalesce(jsonb_agg(jsonb_build_object('id', su.id, 'phone', su.phone, 'student_id', p_student_id)), '[]'::jsonb)
    into v_guardians
    from public.student_guardians sg
    join public.school_users su on su.id = sg.guardian_user_id and su.school_id = v_school
   where sg.student_id = p_student_id;

  select name into v_school_name from public.schools where id = v_school;
  v_body := coalesce(v_school_name, 'School') || ': ' || v_first
            || case when p_kind = 'boarded' then ' boarded the school bus at ' else ' got off the school bus at ' end || v_time || '.';
  v_result := public.bus_alert_deliver(v_school, p_kind, v_route, v_event, p_student_id, v_body, v_guardians, v_me);
  return v_result || jsonb_build_object('event_id', v_event);
end;
$$;
revoke all on function public.record_bus_boarding(uuid, text, uuid) from public, anon;
grant execute on function public.record_bus_boarding(uuid, text, uuid) to authenticated;

-- 13. A guardian's own opt-in / opt-out.
create or replace function public.set_my_bus_alerts(p_enabled boolean)
returns void
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_school uuid := auth_school_id();
  v_me uuid := auth_school_user_id();
begin
  if v_school is null or v_me is null then
    raise exception 'Not authorized.' using errcode = '42501';
  end if;
  if not public.school_has_feature_flag(v_school, 'feature.transport.guardian_alerts') then
    raise exception 'Guardian bus alerts are not enabled for this school.' using errcode = '55000';
  end if;
  if p_enabled is null then
    raise exception 'Invalid choice.' using errcode = '22023';
  end if;
  insert into public.bus_alert_preferences (school_user_id, school_id, enabled, updated_at)
  values (v_me, v_school, p_enabled, now())
  on conflict (school_user_id) do update set enabled = excluded.enabled, updated_at = excluded.updated_at;
end;
$$;
revoke all on function public.set_my_bus_alerts(boolean) from public, anon;
grant execute on function public.set_my_bus_alerts(boolean) to authenticated;

-- 14. Read-only roll-call check for one day: bus roll-call versus class roll-call and the school gate.
--     Sends nothing. Staff use it to spot a learner scanned out at the gate but never recorded boarding, etc.
create or replace function public.bus_boarding_reconciliation(p_date date default null)
returns table (
  student_id uuid,
  student_name text,
  route_name text,
  roll_call_present boolean,
  gate_in boolean,
  gate_out boolean,
  boarded boolean,
  dropped_off boolean
)
language plpgsql
stable
security definer
set search_path to 'public'
as $$
declare
  v_school uuid := auth_school_id();
  v_day date := coalesce(p_date, (now() at time zone 'Africa/Nairobi')::date);
begin
  if v_school is null or not auth_has_permission('transport.read_any') then
    raise exception 'Not authorized.' using errcode = '42501';
  end if;
  if not public.school_has_feature_flag(v_school, 'feature.transport.guardian_alerts') then
    raise exception 'Guardian bus alerts are not enabled for this school.' using errcode = '55000';
  end if;
  return query
    select st.id,
           btrim(st.first_name || ' ' || st.last_name),
           r.name,
           exists (select 1 from public.student_attendance sa
                    where sa.student_id = st.id and sa.attendance_date = v_day and sa.session = 'class' and sa.status in ('present', 'late')),
           exists (select 1 from public.biometric_events be
                    where be.person_type = 'student' and be.person_id = st.id and be.event_type = 'check_in'
                      and (be.occurred_at at time zone 'Africa/Nairobi')::date = v_day),
           exists (select 1 from public.biometric_events be
                    where be.person_type = 'student' and be.person_id = st.id and be.event_type = 'check_out'
                      and (be.occurred_at at time zone 'Africa/Nairobi')::date = v_day),
           exists (select 1 from public.bus_boarding_events e
                    where e.student_id = st.id and e.kind = 'boarded' and (e.occurred_at at time zone 'Africa/Nairobi')::date = v_day),
           exists (select 1 from public.bus_boarding_events e
                    where e.student_id = st.id and e.kind = 'dropped_off' and (e.occurred_at at time zone 'Africa/Nairobi')::date = v_day)
      from public.student_transport_assignments a
      join public.students st on st.id = a.student_id and st.school_id = v_school and st.status not in ('withdrawn', 'transferred', 'graduated')
      join public.transport_routes r on r.id = a.route_id
     where a.school_id = v_school and a.status = 'active'
       and (a.end_date is null or a.end_date >= v_day)
     order by r.name, st.last_name, st.first_name;
end;
$$;
revoke all on function public.bus_boarding_reconciliation(date) from public, anon;
grant execute on function public.bus_boarding_reconciliation(date) to authenticated;
