-- Behavioural test for WP 5.3 bot part (migration *_bot_bus_status_core). Rollback-only, synthetic fixtures.
--   psql "$SUPABASE_DB_URL" -v ON_ERROR_STOP=1 -f supabase/tests/bot_bus_status.sql
-- Only flips flags on its own fixture schools; never asserts anything about real schools' flags.
begin;

do $$
declare
  sa uuid := gen_random_uuid(); sb uuid := gen_random_uuid();
  u_par_a uuid := gen_random_uuid(); u_par_a2 uuid := gen_random_uuid(); u_par_b uuid := gen_random_uuid();
  r_par uuid; su_par_a uuid; su_par_a2 uuid; su_par_b uuid;
  f_live uuid; f_par uuid;
  rt_n uuid := gen_random_uuid(); rt_s uuid := gen_random_uuid(); rt_b uuid := gen_random_uuid();
  v_n uuid := gen_random_uuid(); v_s1 uuid := gen_random_uuid(); v_s2 uuid := gen_random_uuid(); v_b uuid := gen_random_uuid();
  stp uuid := gen_random_uuid();
  dev_n uuid := gen_random_uuid(); dev_b uuid := gen_random_uuid();
  st_ann uuid := gen_random_uuid(); st_ben uuid := gen_random_uuid(); st_cy uuid := gen_random_uuid();
  st_di uuid := gen_random_uuid(); st_fay uuid := gen_random_uuid(); st_zed uuid := gen_random_uuid();
  res jsonb;
begin
  select id into r_par from roles where name = 'parent';
  select id into f_live from platform_feature_flags where key = 'feature.transport.live_tracking';
  select id into f_par from platform_feature_flags where key = 'feature.transport.parent_bus_view';
  assert r_par is not null and f_live is not null and f_par is not null, 'role and flags exist';

  insert into auth.users (id, aud, role, email) values
    (u_par_a, 'authenticated', 'authenticated', 'botbus-par-a@example.invalid'),
    (u_par_a2, 'authenticated', 'authenticated', 'botbus-par-a2@example.invalid'),
    (u_par_b, 'authenticated', 'authenticated', 'botbus-par-b@example.invalid');
  insert into schools (id, name, slug, application_number_prefix) values (sa, 'BotBus A', 'botbus-a', 'BBA'), (sb, 'BotBus B', 'botbus-b', 'BBB');
  insert into school_users (auth_user_id, school_id, role_id, full_name, status) values (u_par_a, sa, r_par, 'Parent A', 'active') returning id into su_par_a;
  insert into school_users (auth_user_id, school_id, role_id, full_name, status) values (u_par_a2, sa, r_par, 'Parent A2', 'active') returning id into su_par_a2;
  insert into school_users (auth_user_id, school_id, role_id, full_name, status) values (u_par_b, sb, r_par, 'Parent B', 'active') returning id into su_par_b;

  insert into transport_routes (id, school_id, name) values (rt_n, sa, 'North Route'), (rt_s, sa, 'South Route'), (rt_b, sb, 'B Route');
  insert into transport_vehicles (id, school_id, registration_number, capacity, route_id, driver_name, driver_phone) values
    (v_n, sa, 'KBA 100A', 40, rt_n, 'Driver Njoroge', '0700000001'), (v_s1, sa, 'KBA 200B', 40, rt_s, null, null),
    (v_s2, sa, 'KBA 300C', 40, rt_s, null, null), (v_b, sb, 'KBB 900Z', 40, rt_b, null, null);
  insert into transport_stops (id, school_id, route_id, name, sequence) values (stp, sa, rt_n, 'Gate Stop', 1);
  insert into vehicle_tracker_devices (id, school_id, vehicle_id, label, token_hash) values
    (dev_n, sa, v_n, 'North phone', repeat('e', 64)), (dev_b, sb, v_b, 'B phone', repeat('f', 64));
  insert into students (id, school_id, first_name, last_name, date_of_birth, gender, status) values
    (st_ann, sa, 'Ann', 'Alpha', date '2012-01-01', 'female', 'approved'), (st_ben, sa, 'Ben', 'Bravo', date '2012-01-02', 'male', 'approved'),
    (st_cy, sa, 'Cy', 'Charlie', date '2012-01-03', 'male', 'approved'), (st_di, sa, 'Di', 'Delta', date '2012-01-04', 'female', 'approved'),
    (st_fay, sa, 'Fay', 'Foxtrot', date '2012-01-06', 'female', 'approved'), (st_zed, sb, 'Zed', 'Zulu', date '2012-01-07', 'male', 'approved');
  insert into student_guardians (student_id, guardian_user_id, relationship) values
    (st_ann, su_par_a, 'mother'), (st_cy, su_par_a, 'mother'), (st_di, su_par_a, 'mother'), (st_fay, su_par_a, 'mother'),
    (st_ben, su_par_a2, 'father'), (st_zed, su_par_b, 'mother');
  insert into student_transport_assignments (school_id, student_id, route_id, vehicle_id, stop_id, status, start_date, end_date) values
    (sa, st_ann, rt_n, v_n, stp, 'active', current_date - 30, null),
    (sa, st_ben, rt_n, v_n, null, 'active', current_date - 30, null),
    (sa, st_cy, rt_n, null, null, 'active', current_date - 30, null),
    (sa, st_di, rt_s, null, null, 'active', current_date - 30, null),
    (sb, st_zed, rt_b, v_b, null, 'active', current_date - 30, null);
  insert into vehicle_positions (school_id, vehicle_id, device_id, recorded_at, lat, lng, speed_kph, heading, accuracy_m) values
    (sa, v_n, dev_n, now() - interval '2 minutes', -1.2863891, 36.8172312, 31.5, 92, 8);

  -- 1. flags off => bot_bus_enabled false and status disabled (for a legitimate guardian)
  assert bot_bus_enabled(sa) = false, '1: off by default';
  assert (bot_guardian_bus_status(sa, su_par_a, st_ann))->>'status' = 'disabled', '1: disabled when flags are off';

  -- 2. only one of the two flags => still off
  insert into school_feature_flags (school_id, flag_id, enabled) values (sa, f_live, true);
  assert bot_bus_enabled(sa) = false, '2: tracking alone is not enough';
  insert into school_feature_flags (school_id, flag_id, enabled) values (sa, f_par, true);
  assert bot_bus_enabled(sa) = true, '2: both on';

  -- 3. live: route, stop, age only. No coordinates, no vehicle or driver details, no names or ids
  res := bot_guardian_bus_status(sa, su_par_a, st_ann);
  assert res->>'status' = 'live', '3: live: ' || res::text;
  assert res->>'route' = 'North Route' and res->>'stop' = 'Gate Stop', '3: route and stop';
  assert (res->>'age_seconds')::int between 119 and 121, '3: age about two minutes';
  assert not (res ? 'lat') and not (res ? 'lng') and not (res ? 'speed_kph') and not (res ? 'heading'), '3: no position fields';
  assert res::text not like '%-1.28%' and res::text not like '%36.81%' and res::text not like '%KBA%' and res::text not like '%Njoroge%' and res::text not like '%0700000001%', '3: no coordinates, registration, driver';
  assert res::text not like '%Ann%' and res::text not like '%Ben%' and res::text not like '%' || st_ann::text || '%' and res::text not like '%' || v_n::text || '%', '3: no names or ids';

  -- 4. forbidden: another guardian's child, another school's child, wrong school for the guardian, unknown ids, nulls
  assert (bot_guardian_bus_status(sa, su_par_a, st_ben))->>'status' = 'forbidden', '4: someone else''s child';
  assert (bot_guardian_bus_status(sa, su_par_a, st_zed))->>'status' = 'forbidden', '4: other school''s child';
  assert (bot_guardian_bus_status(sb, su_par_a, st_ann))->>'status' = 'forbidden', '4: guardian is not of the school passed';
  assert (bot_guardian_bus_status(sa, gen_random_uuid(), st_ann))->>'status' = 'forbidden', '4: unknown guardian';
  assert (bot_guardian_bus_status(sa, su_par_a, gen_random_uuid()))->>'status' = 'forbidden', '4: unknown learner';
  assert (bot_guardian_bus_status(null, su_par_a, st_ann))->>'status' = 'forbidden', '4: null school';
  assert (bot_guardian_bus_status(sa, null, st_ann))->>'status' = 'forbidden', '4: null guardian';
  assert (bot_guardian_bus_status(sa, su_par_a, null))->>'status' = 'forbidden', '4: null learner';

  -- 5. an inactive guardian is forbidden
  update school_users set status = 'inactive' where id = su_par_a2;
  assert (bot_guardian_bus_status(sa, su_par_a2, st_ben))->>'status' = 'forbidden', '5: inactive guardian';
  update school_users set status = 'active' where id = su_par_a2;

  -- 6. vehicle resolution: one vehicle on the route => used; two => no_vehicle (not a guess)
  assert (bot_guardian_bus_status(sa, su_par_a, st_cy))->>'status' = 'live', '6: exactly one vehicle on the route';
  res := bot_guardian_bus_status(sa, su_par_a, st_di);
  assert res->>'status' = 'no_vehicle' and res->>'route' = 'South Route', '6: ambiguous route';

  -- 7. no assignment
  assert (bot_guardian_bus_status(sa, su_par_a, st_fay))->>'status' = 'no_assignment', '7: no assignment';
  update student_transport_assignments set start_date = current_date + 10 where student_id = st_cy;
  assert (bot_guardian_bus_status(sa, su_par_a, st_cy))->>'status' = 'no_assignment', '7: not started yet';

  -- 8. stale position => not_live with no age
  update vehicle_positions set recorded_at = now() - interval '11 minutes' where vehicle_id = v_n;
  res := bot_guardian_bus_status(sa, su_par_a, st_ann);
  assert res->>'status' = 'not_live' and not (res ? 'age_seconds'), '8: 11 minutes old is not live: ' || res::text;

  -- 9. privileges: service_role only
  assert has_function_privilege('service_role', 'public.bot_bus_enabled(uuid)', 'execute'), '9: service_role may run bot_bus_enabled';
  assert has_function_privilege('service_role', 'public.bot_guardian_bus_status(uuid, uuid, uuid)', 'execute'), '9: service_role may run status';
  assert not has_function_privilege('anon', 'public.bot_bus_enabled(uuid)', 'execute'), '9: anon may not';
  assert not has_function_privilege('authenticated', 'public.bot_bus_enabled(uuid)', 'execute'), '9: authenticated may not';
  assert not has_function_privilege('anon', 'public.bot_guardian_bus_status(uuid, uuid, uuid)', 'execute'), '9: anon may not run status';
  assert not has_function_privilege('authenticated', 'public.bot_guardian_bus_status(uuid, uuid, uuid)', 'execute'), '9: authenticated may not run status';

  raise notice 'bot bus status behavioural checks: all passed';
end
$$;

rollback;

do $$
begin
  if exists (select 1 from schools where slug in ('botbus-a', 'botbus-b'))
     or exists (select 1 from auth.users where email like 'botbus-%@example.invalid') then
    raise exception 'LEAK DETECTED: bot-bus-status test fixtures were not rolled back -- fix this test file before trusting it again';
  end if;
end
$$;
