-- Behavioural test for WP 5.2 (migration *_driver_route_for_device). Rollback-only, synthetic fixtures.
--   psql "$SUPABASE_DB_URL" -v ON_ERROR_STOP=1 -f supabase/tests/driver_route.sql
-- driver_route_for_device is service_role only, so it is called here as the connecting (privileged) role, exactly as
-- the /api/driver/route handler calls it. One transaction ending in `rollback;` plus a leak tripwire.
begin;

do $$
declare
  sa uuid := gen_random_uuid(); sb uuid := gen_random_uuid();
  u_tm_a uuid := gen_random_uuid(); r_tm uuid; v_flag uuid;
  veh uuid := gen_random_uuid(); veh2 uuid := gen_random_uuid(); veh_b uuid := gen_random_uuid();
  rt uuid := gen_random_uuid(); rt_b uuid := gen_random_uuid();
  s1 uuid := gen_random_uuid(); s2 uuid := gen_random_uuid(); s_b uuid := gen_random_uuid();
  st1 uuid := gen_random_uuid(); st2 uuid := gen_random_uuid(); st3 uuid := gen_random_uuid(); st4 uuid := gen_random_uuid(); st5 uuid := gen_random_uuid(); st_b uuid := gen_random_uuid();
  dev uuid; tok text; thash text; res jsonb;
begin
  select id into r_tm from roles where name = 'transport_manager';
  assert r_tm is not null, 'role exists';
  insert into auth.users (id, aud, role, email) values (u_tm_a, 'authenticated', 'authenticated', 'drvroute-tm-a@example.invalid');
  insert into schools (id, name, slug, application_number_prefix) values (sa, 'DrvRoute A', 'drvroute-a', 'DRA'), (sb, 'DrvRoute B', 'drvroute-b', 'DRB');
  insert into school_users (auth_user_id, school_id, role_id, full_name, status) values (u_tm_a, sa, r_tm, 'TM A', 'active');

  insert into transport_routes (id, school_id, name) values (rt, sa, 'North Route'), (rt_b, sb, 'Other School Route');
  insert into transport_vehicles (id, school_id, registration_number, capacity, route_id) values
    (veh, sa, 'KAA 100A', 40, rt), (veh2, sa, 'KAA 200B', 30, null), (veh_b, sb, 'KBB 300C', 40, rt_b);
  insert into transport_stops (id, school_id, route_id, name, sequence, pickup_time) values
    (s1, sa, rt, 'Second Stop', 2, '07:30'), (s2, sa, rt, 'First Stop', 1, '07:00'), (s_b, sb, rt_b, 'B Stop', 1, '07:00');
  insert into students (id, school_id, first_name, last_name, date_of_birth, gender, status) values
    (st1, sa, 'Ann', 'One', date '2012-01-01', 'female', 'approved'), (st2, sa, 'Ben', 'Two', date '2012-01-02', 'male', 'approved'),
    (st3, sa, 'Cy', 'Three', date '2012-01-03', 'male', 'approved'), (st4, sa, 'Di', 'Four', date '2012-01-04', 'female', 'approved'),
    (st5, sa, 'Ed', 'Five', date '2012-01-05', 'male', 'approved'), (st_b, sb, 'Zed', 'Other', date '2012-01-06', 'male', 'approved');
  -- First Stop: 2 riders (one on the vehicle, one with no vehicle yet on the same route); Second Stop: 1; no stop: 1; ended: ignored.
  insert into student_transport_assignments (school_id, student_id, route_id, vehicle_id, stop_id, status) values
    (sa, st1, rt, veh, s2, 'active'), (sa, st2, rt, null, s2, 'active'), (sa, st3, rt, veh, s1, 'active'),
    (sa, st4, rt, veh, null, 'active'), (sa, st5, rt, veh, s1, 'ended'),
    (sb, st_b, rt_b, veh_b, s_b, 'active');

  select id into v_flag from platform_feature_flags where key = 'feature.transport.live_tracking';
  assert v_flag is not null, 'flag catalog entry exists (WP 5.1)';
  insert into school_feature_flags (school_id, flag_id, enabled) values (sa, v_flag, true);

  -- make a real device the way a manager would, so the token/hash path is the production one
  execute 'set local role authenticated';
  perform set_config('request.jwt.claims', json_build_object('sub', u_tm_a, 'role', 'authenticated')::text, true);
  select d.device_id, d.token into dev, tok from create_tracker_device(veh, 'Driver phone') d;
  execute 'reset role';
  thash := encode(sha256(convert_to(tok, 'UTF8')), 'hex');

  -- 1. unknown token
  assert (driver_route_for_device(repeat('0', 64)))->>'status' = 'invalid', '1: unknown token is invalid';

  -- 2. happy path
  res := driver_route_for_device(thash);
  assert res->>'status' = 'ok', '2: ok';
  assert res->'vehicle'->>'registration_number' = 'KAA 100A' and (res->'vehicle'->>'capacity')::int = 40, '2: vehicle';
  assert res->'route'->>'name' = 'North Route', '2: route name';
  assert jsonb_array_length(res->'stops') = 2, '2: two stops (other schools stop excluded)';
  assert res->'stops'->0->>'name' = 'First Stop' and res->'stops'->1->>'name' = 'Second Stop', '2: stops in sequence order';
  assert res->'stops'->0->>'pickup_time' = '07:00', '2: pickup time formatted';
  assert (res->'stops'->0->>'riders')::int = 2, '2: first stop riders (vehicle + route-with-no-vehicle)';
  assert (res->'stops'->1->>'riders')::int = 1, '2: second stop riders (ended assignment ignored)';
  assert (res->>'riders_without_stop')::int = 1, '2: rider with no stop counted';
  assert (res->>'riders_total')::int = 4, '2: total active riders';
  assert res->>'device_label' = 'Driver phone', '2: label';

  -- 3. data minimisation: nothing about individual learners leaves the database
  assert res::text not like '%Ann%' and res::text not like '%Ben%' and res::text not like '%One%', '3: no learner names';
  assert res::text not like '%' || st1::text || '%', '3: no learner ids';
  assert res::text not like '%Zed%', '3: other schools data absent';

  -- 4. flag off => disabled; back on => ok
  update school_feature_flags set enabled = false where school_id = sa and flag_id = v_flag;
  assert (driver_route_for_device(thash))->>'status' = 'disabled', '4: flag off is disabled';
  update school_feature_flags set enabled = true where school_id = sa and flag_id = v_flag;
  assert (driver_route_for_device(thash))->>'status' = 'ok', '4: flag on again is ok';

  -- 5. a vehicle with no route returns no stops and no route
  insert into vehicle_tracker_devices (school_id, vehicle_id, label, token_hash) values (sa, veh2, 'No route phone', repeat('b', 64));
  res := driver_route_for_device(repeat('b', 64));
  assert res->>'status' = 'ok' and res->'route' = 'null'::jsonb and jsonb_array_length(res->'stops') = 0 and (res->>'riders_total')::int = 0, '5: vehicle without a route';

  -- 6. revoked device is invalid
  execute 'set local role authenticated';
  perform set_config('request.jwt.claims', json_build_object('sub', u_tm_a, 'role', 'authenticated')::text, true);
  perform revoke_tracker_device(dev);
  execute 'reset role';
  assert (driver_route_for_device(thash))->>'status' = 'invalid', '6: revoked token is invalid';

  -- 7. privileges: service_role only
  assert has_function_privilege('service_role', 'public.driver_route_for_device(text)', 'execute'), '7: service_role may execute';
  assert not has_function_privilege('authenticated', 'public.driver_route_for_device(text)', 'execute'), '7: authenticated may not';
  assert not has_function_privilege('anon', 'public.driver_route_for_device(text)', 'execute'), '7: anon may not';

  raise notice 'driver route behavioural checks: all passed';
end
$$;

rollback;

do $$
begin
  if exists (select 1 from schools where slug in ('drvroute-a', 'drvroute-b'))
     or exists (select 1 from auth.users where email like 'drvroute-%@example.invalid') then
    raise exception 'LEAK DETECTED: driver-route test fixtures were not rolled back -- fix this test file before trusting it again';
  end if;
end
$$;
