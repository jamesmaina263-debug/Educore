-- Behavioural test for WP 5.1 (migration *_vehicle_positions_core). Rollback-only, synthetic fixtures.
--   psql "$SUPABASE_DB_URL" -v ON_ERROR_STOP=1 -f supabase/tests/vehicle_positions.sql
-- Callers are simulated with request.jwt.claims + role authenticated. Everything ends in `rollback;`
-- and a tripwire fails loudly if any fixture row ever persisted.
begin;

do $$
declare
  sa uuid := gen_random_uuid(); sb uuid := gen_random_uuid();
  u_tm_a uuid := gen_random_uuid(); u_tm_b uuid := gen_random_uuid();
  u_dep_a uuid := gen_random_uuid(); u_tea_a uuid := gen_random_uuid();
  r_tm uuid; r_dep uuid; r_tea uuid; v_flag uuid;
  veh_a uuid := gen_random_uuid(); veh_b uuid := gen_random_uuid();
  dev uuid; tok text; thash text; res jsonb; n integer; v_failed boolean;
begin
  select id into r_tm from roles where name = 'transport_manager';
  select id into r_dep from roles where name = 'deputy_principal';
  select id into r_tea from roles where name = 'teacher';
  assert r_tm is not null and r_dep is not null and r_tea is not null, 'roles exist';

  insert into auth.users (id, aud, role, email) values
    (u_tm_a, 'authenticated', 'authenticated', 'vpos-tm-a@example.invalid'),
    (u_tm_b, 'authenticated', 'authenticated', 'vpos-tm-b@example.invalid'),
    (u_dep_a, 'authenticated', 'authenticated', 'vpos-dep-a@example.invalid'),
    (u_tea_a, 'authenticated', 'authenticated', 'vpos-tea-a@example.invalid');
  insert into schools (id, name, slug, application_number_prefix) values
    (sa, 'VPos A', 'vpos-a', 'VPA'), (sb, 'VPos B', 'vpos-b', 'VPB');
  insert into school_users (auth_user_id, school_id, role_id, full_name, status) values
    (u_tm_a, sa, r_tm, 'TM A', 'active'), (u_tm_b, sb, r_tm, 'TM B', 'active'),
    (u_dep_a, sa, r_dep, 'Dep A', 'active'), (u_tea_a, sa, r_tea, 'Teacher A', 'active');
  insert into transport_vehicles (id, school_id, registration_number, capacity) values
    (veh_a, sa, 'KAA 001A', 40), (veh_b, sb, 'KBB 002B', 40);

  select id into v_flag from platform_feature_flags where key = 'feature.transport.live_tracking';
  assert v_flag is not null, 'flag catalog entry exists';

  -- 1. flag OFF: creating a device is refused (42501)
  execute 'set local role authenticated';
  perform set_config('request.jwt.claims', json_build_object('sub', u_tm_a, 'role', 'authenticated')::text, true);
  v_failed := false;
  begin perform create_tracker_device(veh_a, 'Driver phone'); exception when sqlstate '42501' then v_failed := true; end;
  assert v_failed, '1: flag off must refuse device creation';

  execute 'reset role';
  insert into school_feature_flags (school_id, flag_id, enabled) values (sa, v_flag, true);

  -- 2. teacher / deputy (no transport.write) refused; cross-school vehicle refused
  execute 'set local role authenticated';
  perform set_config('request.jwt.claims', json_build_object('sub', u_tea_a, 'role', 'authenticated')::text, true);
  v_failed := false;
  begin perform create_tracker_device(veh_a, 'x'); exception when sqlstate '42501' then v_failed := true; end;
  assert v_failed, '2: teacher refused';
  perform set_config('request.jwt.claims', json_build_object('sub', u_dep_a, 'role', 'authenticated')::text, true);
  v_failed := false;
  begin perform create_tracker_device(veh_a, 'x'); exception when sqlstate '42501' then v_failed := true; end;
  assert v_failed, '2: deputy (read-only) refused';
  perform set_config('request.jwt.claims', json_build_object('sub', u_tm_a, 'role', 'authenticated')::text, true);
  v_failed := false;
  begin perform create_tracker_device(veh_b, 'x'); exception when sqlstate 'P0002' then v_failed := true; end;
  assert v_failed, '2: another school''s vehicle refused';

  -- 3. manager creates a device; token returned once, only the hash is stored
  select d.device_id, d.token into dev, tok from create_tracker_device(veh_a, 'Driver phone') d;
  assert dev is not null and tok like 'vt\_%' and char_length(tok) = 67, '3: token shape';
  thash := encode(sha256(convert_to(tok, 'UTF8')), 'hex');
  execute 'reset role';
  assert (select token_hash from vehicle_tracker_devices where id = dev) = thash, '3: hash stored';
  assert not exists (select 1 from vehicle_tracker_devices where token_hash = tok), '3: raw token never stored';
  assert exists (select 1 from audit_log where record_id = dev and action = 'tracker_device_created'), '3: audited';

  -- 4. token_hash column is not readable by authenticated
  execute 'set local role authenticated';
  perform set_config('request.jwt.claims', json_build_object('sub', u_tm_a, 'role', 'authenticated')::text, true);
  v_failed := false;
  begin perform token_hash from vehicle_tracker_devices; exception when insufficient_privilege then v_failed := true; end;
  assert v_failed, '4: token_hash must not be selectable';
  assert (select count(*) from vehicle_tracker_devices) = 1, '4: manager sees own school device';

  -- 5. ingestion is service-role only
  v_failed := false;
  begin perform ingest_vehicle_positions(thash, '[]'::jsonb); exception when insufficient_privilege then v_failed := true; end;
  assert v_failed, '5: authenticated cannot ingest';
  execute 'reset role';

  -- 6. ingest: good, duplicate, rejected (future, bad lat, missing coords)
  assert (ingest_vehicle_positions('nope', '[]'::jsonb))->>'status' = 'invalid', '6: unknown token invalid';
  res := ingest_vehicle_positions(thash, jsonb_build_array(
    jsonb_build_object('t', now() - interval '2 minutes', 'lat', -1.2921, 'lng', 36.8219, 'speed_kph', 40, 'heading', 90, 'accuracy_m', 8),
    jsonb_build_object('t', now() - interval '1 minute', 'lat', -1.2930, 'lng', 36.8230),
    jsonb_build_object('t', now() + interval '1 hour', 'lat', 0, 'lng', 0),
    jsonb_build_object('t', now() - interval '3 minutes', 'lat', 123, 'lng', 0),
    jsonb_build_object('t', now() - interval '4 minutes')));
  assert res->>'status' = 'ok' and (res->>'accepted')::int = 2 and (res->>'rejected')::int = 3, '6: counts ' || res::text;
  select count(*) into n from vehicle_positions where device_id = dev;
  assert n = 2, '6: two rows stored';
  res := ingest_vehicle_positions(thash, jsonb_build_array(
    jsonb_build_object('t', (select recorded_at from vehicle_positions where device_id = dev order by recorded_at limit 1), 'lat', 1, 'lng', 1)));
  assert (res->>'duplicates')::int = 1 and (res->>'accepted')::int = 0, '6: duplicate ignored';
  assert (ingest_vehicle_positions(thash, '{}'::jsonb))->>'status' = 'bad_request', '6: non-array rejected';
  assert (select last_seen_at from vehicle_tracker_devices where id = dev) is not null, '6: last_seen updated';

  -- 7. read access: manager + deputy of the school yes; teacher no; other school no
  execute 'set local role authenticated';
  perform set_config('request.jwt.claims', json_build_object('sub', u_tm_a, 'role', 'authenticated')::text, true);
  assert (select count(*) from vehicle_positions) = 2, '7: manager reads positions';
  assert (select count(*) from v_vehicle_latest_position) = 1, '7: latest view one row per vehicle';
  perform set_config('request.jwt.claims', json_build_object('sub', u_dep_a, 'role', 'authenticated')::text, true);
  assert (select count(*) from vehicle_positions) = 2, '7: deputy reads positions';
  perform set_config('request.jwt.claims', json_build_object('sub', u_tea_a, 'role', 'authenticated')::text, true);
  assert (select count(*) from vehicle_positions) = 0, '7: teacher sees nothing';
  perform set_config('request.jwt.claims', json_build_object('sub', u_tm_b, 'role', 'authenticated')::text, true);
  assert (select count(*) from vehicle_positions) = 0, '7: other school sees nothing';
  assert (select count(*) from vehicle_tracker_devices) = 0, '7: other school sees no devices';
  v_failed := false;
  begin insert into vehicle_positions (school_id, vehicle_id, device_id, recorded_at, lat, lng) values (sb, veh_b, dev, now(), 0, 0);
  exception when insufficient_privilege then v_failed := true; end;
  assert v_failed, '7: no direct writes';
  execute 'reset role';

  -- 8. revoke: other school cannot; owner can; token then invalid; second revoke is a no-op
  execute 'set local role authenticated';
  perform set_config('request.jwt.claims', json_build_object('sub', u_tm_b, 'role', 'authenticated')::text, true);
  v_failed := false;
  begin perform revoke_tracker_device(dev); exception when sqlstate 'P0002' then v_failed := true; end;
  assert v_failed, '8: other school cannot revoke';
  perform set_config('request.jwt.claims', json_build_object('sub', u_tm_a, 'role', 'authenticated')::text, true);
  perform revoke_tracker_device(dev);
  perform revoke_tracker_device(dev);
  execute 'reset role';
  assert (select count(*) from audit_log where record_id = dev and action = 'tracker_device_revoked') = 1, '8: revoke audited once';
  assert (ingest_vehicle_positions(thash, '[]'::jsonb))->>'status' = 'invalid', '8: revoked token invalid';

  -- 9. flag turned off after creation: ingest returns disabled (new device so it is active)
  execute 'set local role authenticated';
  perform set_config('request.jwt.claims', json_build_object('sub', u_tm_a, 'role', 'authenticated')::text, true);
  select d.device_id, d.token into dev, tok from create_tracker_device(veh_a, 'Second') d;
  execute 'reset role';
  thash := encode(sha256(convert_to(tok, 'UTF8')), 'hex');
  update school_feature_flags set enabled = false where school_id = sa and flag_id = v_flag;
  assert (ingest_vehicle_positions(thash, '[]'::jsonb))->>'status' = 'disabled', '9: flag off disables ingest';

  -- 10. purge: min 7 days; deletes only older rows
  v_failed := false;
  begin perform purge_vehicle_positions(3); exception when sqlstate '22023' then v_failed := true; end;
  assert v_failed, '10: retention below 7 days refused';
  -- Scoped to the fixture school: real schools now have live tracker data in this table, so the
  -- test must not assume it is empty. purge_vehicle_positions() is global, so it may also purge
  -- real rows older than the retention window; only the fixture rows are asserted on.
  update vehicle_positions set recorded_at = now() - interval '40 days' where id = (select min(id) from vehicle_positions where school_id = sa);
  assert purge_vehicle_positions(30) >= 1, '10: purged at least the old row';
  assert not exists (select 1 from vehicle_positions where school_id = sa and recorded_at < now() - interval '30 days'), '10: old fixture row purged';
  assert (select count(*) from vehicle_positions where school_id = sa) = 1, '10: recent row kept';
end
$$;

rollback;

-- Tripwire: runs AFTER the rollback, so any surviving fixture row is a real leak.
do $$
begin
  if exists (select 1 from schools where slug in ('vpos-a', 'vpos-b'))
     or exists (select 1 from auth.users where email like 'vpos-%@example.invalid') then
    raise exception 'LEAK DETECTED: vehicle-positions test fixtures were not rolled back -- fix this test file before trusting it again';
  end if;
end
$$;
