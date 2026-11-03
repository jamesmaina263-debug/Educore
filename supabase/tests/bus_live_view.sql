-- Behavioural test for WP 5.3 (migration *_bus_live_view). Rollback-only, synthetic fixtures.
--   psql "$SUPABASE_DB_URL" -v ON_ERROR_STOP=1 -f supabase/tests/bus_live_view.sql
-- Runs the REAL deployed functions and policies with real role impersonation (set local role + request.jwt.claims).
-- It only ever flips flags on its own fixture schools and never asserts anything about real schools' flags, so a
-- school that switches these features on in production cannot make it fail. One transaction ending in `rollback;`
-- plus a leak tripwire in its own transaction.
begin;

do $$
declare
  sa uuid := gen_random_uuid(); sb uuid := gen_random_uuid();
  u_tm_a uuid := gen_random_uuid(); u_tm_b uuid := gen_random_uuid();
  u_par_a uuid := gen_random_uuid(); u_par_a2 uuid := gen_random_uuid(); u_par_b uuid := gen_random_uuid();
  r_tm uuid; r_par uuid; su_par_a uuid; su_par_a2 uuid; su_par_b uuid;
  f_live uuid; f_par uuid;
  rt_n uuid := gen_random_uuid(); rt_s uuid := gen_random_uuid(); rt_b uuid := gen_random_uuid();
  v_n uuid := gen_random_uuid(); v_s1 uuid := gen_random_uuid(); v_s2 uuid := gen_random_uuid(); v_x uuid := gen_random_uuid(); v_b uuid := gen_random_uuid();
  stp uuid := gen_random_uuid();
  dev_n uuid := gen_random_uuid(); dev_b uuid := gen_random_uuid();
  st_ann uuid := gen_random_uuid(); st_ben uuid := gen_random_uuid(); st_cy uuid := gen_random_uuid(); st_di uuid := gen_random_uuid();
  st_ed uuid := gen_random_uuid(); st_fay uuid := gen_random_uuid(); st_zed uuid := gen_random_uuid();
  res jsonb; n integer; ok boolean;
begin
  select id into r_tm from roles where name = 'transport_manager';
  select id into r_par from roles where name = 'parent';
  assert r_tm is not null and r_par is not null, 'roles exist';
  select id into f_live from platform_feature_flags where key = 'feature.transport.live_tracking';
  select id into f_par from platform_feature_flags where key = 'feature.transport.parent_bus_view';
  assert f_live is not null, 'live_tracking flag is in the catalog (WP 5.1)';
  assert f_par is not null, 'parent_bus_view flag is in the catalog (WP 5.3)';

  insert into auth.users (id, aud, role, email) values
    (u_tm_a, 'authenticated', 'authenticated', 'busview-tm-a@example.invalid'),
    (u_tm_b, 'authenticated', 'authenticated', 'busview-tm-b@example.invalid'),
    (u_par_a, 'authenticated', 'authenticated', 'busview-par-a@example.invalid'),
    (u_par_a2, 'authenticated', 'authenticated', 'busview-par-a2@example.invalid'),
    (u_par_b, 'authenticated', 'authenticated', 'busview-par-b@example.invalid');
  insert into schools (id, name, slug, application_number_prefix) values (sa, 'BusView A', 'busview-a', 'BVA'), (sb, 'BusView B', 'busview-b', 'BVB');
  insert into school_users (auth_user_id, school_id, role_id, full_name, status) values (u_tm_a, sa, r_tm, 'TM A', 'active'), (u_tm_b, sb, r_tm, 'TM B', 'active');
  insert into school_users (auth_user_id, school_id, role_id, full_name, status) values (u_par_a, sa, r_par, 'Parent A', 'active') returning id into su_par_a;
  insert into school_users (auth_user_id, school_id, role_id, full_name, status) values (u_par_a2, sa, r_par, 'Parent A2', 'active') returning id into su_par_a2;
  insert into school_users (auth_user_id, school_id, role_id, full_name, status) values (u_par_b, sb, r_par, 'Parent B', 'active') returning id into su_par_b;

  insert into transport_routes (id, school_id, name) values (rt_n, sa, 'North Route'), (rt_s, sa, 'South Route'), (rt_b, sb, 'B Route');
  -- North has exactly one vehicle; South has two (ambiguous); v_x has no route.
  insert into transport_vehicles (id, school_id, registration_number, route_id, driver_name, driver_phone) values
    (v_n, sa, 'KAA 100A', rt_n, 'Driver Njoroge', '0700000001'), (v_s1, sa, 'KAA 200B', rt_s, null, null), (v_s2, sa, 'KAA 300C', rt_s, null, null),
    (v_x, sa, 'KAA 400D', null, null, null), (v_b, sb, 'KBB 900Z', rt_b, null, null);
  insert into transport_stops (id, school_id, route_id, name, sequence) values (stp, sa, rt_n, 'Gate Stop', 1);
  insert into vehicle_tracker_devices (id, school_id, vehicle_id, label, token_hash) values
    (dev_n, sa, v_n, 'North phone', repeat('c', 64)), (dev_b, sb, v_b, 'B phone', repeat('d', 64));

  insert into students (id, school_id, first_name, last_name, date_of_birth, gender, status) values
    (st_ann, sa, 'Ann', 'Alpha', date '2012-01-01', 'female', 'approved'), (st_ben, sa, 'Ben', 'Bravo', date '2012-01-02', 'male', 'approved'),
    (st_cy, sa, 'Cy', 'Charlie', date '2012-01-03', 'male', 'approved'), (st_di, sa, 'Di', 'Delta', date '2012-01-04', 'female', 'approved'),
    (st_ed, sa, 'Ed', 'Echo', date '2012-01-05', 'male', 'approved'), (st_fay, sa, 'Fay', 'Foxtrot', date '2012-01-06', 'female', 'approved'),
    (st_zed, sb, 'Zed', 'Zulu', date '2012-01-07', 'male', 'approved');
  -- Parent A: Ann, Cy, Di, Ed, Fay.  Parent A2: Ben only.  Parent B: Zed.
  insert into student_guardians (student_id, guardian_user_id, relationship) values
    (st_ann, su_par_a, 'mother'), (st_cy, su_par_a, 'mother'), (st_di, su_par_a, 'mother'), (st_ed, su_par_a, 'mother'), (st_fay, su_par_a, 'mother'),
    (st_ben, su_par_a2, 'father'), (st_zed, su_par_b, 'mother');
  insert into student_transport_assignments (school_id, student_id, route_id, vehicle_id, stop_id, status, start_date, end_date) values
    (sa, st_ann, rt_n, v_n, stp, 'active', current_date - 30, null),     -- explicit vehicle, with a stop
    (sa, st_ben, rt_n, v_n, null, 'active', current_date - 30, null),    -- someone else's child, same vehicle
    (sa, st_cy, rt_n, null, null, 'active', current_date - 30, null),    -- no vehicle chosen, route has exactly one
    (sa, st_di, rt_s, null, null, 'active', current_date - 30, null),    -- no vehicle chosen, route has two
    (sa, st_ed, rt_n, v_n, null, 'ended', current_date - 60, current_date - 5), -- ended
    (sb, st_zed, rt_b, v_b, null, 'active', current_date - 30, null);
  -- Fay has no assignment at all.

  -- Positions: North vehicle has an old and a fresh point (fresh is the later one); B has a fresh point.
  insert into vehicle_positions (school_id, vehicle_id, device_id, recorded_at, lat, lng, speed_kph, heading, accuracy_m) values
    (sa, v_n, dev_n, now() - interval '3 hours', -1.1000000, 36.1000000, 0, 0, 5),
    (sa, v_n, dev_n, now() - interval '2 minutes', -1.2863891, 36.8172312, 31.5, 92, 8),
    (sb, v_b, dev_b, now() - interval '1 minute', -4.0000000, 39.0000000, 10, 10, 5);

  -- ===== parent function =====
  execute 'set local role authenticated';
  perform set_config('request.jwt.claims', json_build_object('sub', u_par_a, 'role', 'authenticated')::text, true);

  -- 1. both flags off => disabled
  assert (guardian_bus_status(st_ann))->>'status' = 'disabled', '1: flags off is disabled';

  -- 2. only live_tracking on => still disabled
  execute 'reset role';
  insert into school_feature_flags (school_id, flag_id, enabled) values (sa, f_live, true);
  execute 'set local role authenticated';
  perform set_config('request.jwt.claims', json_build_object('sub', u_par_a, 'role', 'authenticated')::text, true);
  assert (guardian_bus_status(st_ann))->>'status' = 'disabled', '2: tracking alone does not open the parent view';

  -- 3. both on => live with the fresh position, rounded, with route and stop
  execute 'reset role';
  insert into school_feature_flags (school_id, flag_id, enabled) values (sa, f_par, true);
  execute 'set local role authenticated';
  perform set_config('request.jwt.claims', json_build_object('sub', u_par_a, 'role', 'authenticated')::text, true);
  res := guardian_bus_status(st_ann);
  assert res->>'status' = 'live', '3: live: ' || res::text;
  assert (res->>'lat')::numeric = -1.28639 and (res->>'lng')::numeric = 36.81723, '3: coordinates rounded to 5 dp and the FRESH point chosen';
  assert res->'route'->>'name' = 'North Route' and res->>'stop' = 'Gate Stop', '3: route and stop';
  assert (res->>'age_seconds')::int between 119 and 121, '3: age about two minutes';
  assert (res->>'speed_kph')::numeric = 31.5 and (res->>'heading')::numeric = 92, '3: speed and heading';

  -- 4. data minimisation: nothing about the vehicle identity, driver, other learners
  assert res::text not like '%KAA%' and res::text not like '%Njoroge%' and res::text not like '%0700000001%', '4: no registration, driver name or phone';
  assert res::text not like '%Ben%' and res::text not like '%Bravo%' and res::text not like '%Ann%' and res::text not like '%Alpha%', '4: no learner names';
  assert res::text not like '%' || st_ann::text || '%' and res::text not like '%' || v_n::text || '%', '4: no learner or vehicle ids';
  assert res::text not like '%BusView%' and res::text not like '%-4.0%', '4: nothing from another school';

  -- 5. forbidden: another guardian's child in the same school, a child of another school, an unknown id, null
  assert (guardian_bus_status(st_ben))->>'status' = 'forbidden', '5: someone else''s child is forbidden';
  assert (guardian_bus_status(st_zed))->>'status' = 'forbidden', '5: other school''s child is forbidden';
  assert (guardian_bus_status(gen_random_uuid()))->>'status' = 'forbidden', '5: unknown id is forbidden';
  assert (guardian_bus_status(null))->>'status' = 'forbidden', '5: null is forbidden';

  -- 6. vehicle resolution when none was chosen: exactly one on the route => used; two => no_vehicle
  assert (guardian_bus_status(st_cy))->>'status' = 'live', '6: route with exactly one vehicle is used';
  res := guardian_bus_status(st_di);
  assert res->>'status' = 'no_vehicle' and res->'route'->>'name' = 'South Route', '6: ambiguous route => no_vehicle (not a guess)';
  assert not (res ? 'lat'), '6: no_vehicle carries no coordinates';

  -- 7. no usable assignment
  assert (guardian_bus_status(st_ed))->>'status' = 'no_assignment', '7: ended assignment';
  assert (guardian_bus_status(st_fay))->>'status' = 'no_assignment', '7: no assignment';
  execute 'reset role';
  update student_transport_assignments set start_date = current_date + 10 where student_id = st_cy;
  execute 'set local role authenticated';
  perform set_config('request.jwt.claims', json_build_object('sub', u_par_a, 'role', 'authenticated')::text, true);
  assert (guardian_bus_status(st_cy))->>'status' = 'no_assignment', '7: assignment that has not started yet';

  -- 8. a stale position is never shared (no coordinates, no last-seen time)
  execute 'reset role';
  update vehicle_positions set recorded_at = now() - interval '11 minutes' where vehicle_id = v_n and recorded_at > now() - interval '1 hour';
  execute 'set local role authenticated';
  perform set_config('request.jwt.claims', json_build_object('sub', u_par_a, 'role', 'authenticated')::text, true);
  res := guardian_bus_status(st_ann);
  assert res->>'status' = 'not_live', '8: 11 minutes old is not live';
  assert not (res ? 'lat') and not (res ? 'lng') and not (res ? 'recorded_at') and not (res ? 'age_seconds'), '8: stale answer has no coordinates or time';
  assert res::text not like '%-1.28%' and res::text not like '%36.81%', '8: stale coordinates absent';

  -- 9. a vehicle that has never reported => not_live
  execute 'reset role';
  delete from vehicle_positions where vehicle_id = v_n;
  execute 'set local role authenticated';
  perform set_config('request.jwt.claims', json_build_object('sub', u_par_a, 'role', 'authenticated')::text, true);
  assert (guardian_bus_status(st_ann))->>'status' = 'not_live', '9: no positions is not_live';

  -- 10. the other guardian only sees their own child; school B's parent sees nothing of school A
  perform set_config('request.jwt.claims', json_build_object('sub', u_par_a2, 'role', 'authenticated')::text, true);
  assert (guardian_bus_status(st_ann))->>'status' = 'forbidden', '10: A2 may not ask about Ann';
  assert (guardian_bus_status(st_ben))->>'status' <> 'forbidden', '10: A2 may ask about Ben';
  perform set_config('request.jwt.claims', json_build_object('sub', u_par_b, 'role', 'authenticated')::text, true);
  assert (guardian_bus_status(st_ann))->>'status' = 'forbidden', '10: school B parent may not ask about school A child';
  assert (guardian_bus_status(st_zed))->>'status' = 'disabled', '10: school B has the flags off => disabled for its own child';

  -- 11. a signed-in user with no claims at all is refused (auth.uid() null)
  perform set_config('request.jwt.claims', json_build_object('role', 'authenticated')::text, true);
  assert (guardian_bus_status(st_ann))->>'status' = 'forbidden', '11: no uid => forbidden';

  -- 12. flag turned off again => disabled
  execute 'reset role';
  update school_feature_flags set enabled = false where school_id = sa and flag_id = f_par;
  execute 'set local role authenticated';
  perform set_config('request.jwt.claims', json_build_object('sub', u_par_a, 'role', 'authenticated')::text, true);
  assert (guardian_bus_status(st_ann))->>'status' = 'disabled', '12: parent flag off is disabled again';

  -- ===== staff fleet function =====
  execute 'reset role';
  insert into vehicle_positions (school_id, vehicle_id, device_id, recorded_at, lat, lng, speed_kph, heading, accuracy_m) values
    (sa, v_n, dev_n, now() - interval '4 hours', -1.1, 36.1, 0, 0, 5),
    (sa, v_n, dev_n, now() - interval '30 seconds', -1.2, 36.2, 20, 45, 6);
  execute 'set local role authenticated';
  perform set_config('request.jwt.claims', json_build_object('sub', u_tm_a, 'role', 'authenticated')::text, true);

  -- 13. staff with transport.read_any see every vehicle of their own school (incl. never-reported), latest position only
  select count(*) into n from fleet_live_status();
  assert n = 4, '13: school A manager sees its 4 vehicles, got ' || n;
  select (lat = -1.2 and recorded_at > now() - interval '1 minute') into ok from fleet_live_status() where registration_number = 'KAA 100A';
  assert ok, '13: latest position chosen for the vehicle';
  select (lat is null and recorded_at is null) into ok from fleet_live_status() where registration_number = 'KAA 400D';
  assert ok, '13: vehicle that never reported has no position';
  select count(*) into n from fleet_live_status() where registration_number = 'KBB 900Z';
  assert n = 0, '13: other school''s vehicle is not visible';

  -- 14. a parent (no transport.read_any) gets nothing from the staff function
  perform set_config('request.jwt.claims', json_build_object('sub', u_par_a, 'role', 'authenticated')::text, true);
  select count(*) into n from fleet_live_status();
  assert n = 0, '14: parent sees no fleet';

  -- 15. school B manager sees only school B, and only when B has live tracking on
  perform set_config('request.jwt.claims', json_build_object('sub', u_tm_b, 'role', 'authenticated')::text, true);
  select count(*) into n from fleet_live_status();
  assert n = 0, '15: flag off for school B => empty';
  execute 'reset role';
  insert into school_feature_flags (school_id, flag_id, enabled) values (sb, f_live, true);
  execute 'set local role authenticated';
  perform set_config('request.jwt.claims', json_build_object('sub', u_tm_b, 'role', 'authenticated')::text, true);
  select count(*) into n from fleet_live_status();
  assert n = 1, '15: school B manager sees exactly its own vehicle, got ' || n;
  select count(*) into n from fleet_live_status() where registration_number like 'KAA%';
  assert n = 0, '15: school B manager sees none of school A';

  -- 16. live_tracking off => staff function empty even for a manager
  execute 'reset role';
  update school_feature_flags set enabled = false where school_id = sa and flag_id = f_live;
  execute 'set local role authenticated';
  perform set_config('request.jwt.claims', json_build_object('sub', u_tm_a, 'role', 'authenticated')::text, true);
  select count(*) into n from fleet_live_status();
  assert n = 0, '16: tracking off => empty';
  execute 'reset role';

  -- 17. privileges: anon cannot execute either; signed-in users can (the functions check the caller themselves)
  assert not has_function_privilege('anon', 'public.guardian_bus_status(uuid)', 'execute'), '17: anon may not run guardian_bus_status';
  assert not has_function_privilege('anon', 'public.fleet_live_status()', 'execute'), '17: anon may not run fleet_live_status';
  assert has_function_privilege('authenticated', 'public.guardian_bus_status(uuid)', 'execute'), '17: authenticated may run guardian_bus_status';
  assert has_function_privilege('authenticated', 'public.fleet_live_status()', 'execute'), '17: authenticated may run fleet_live_status';

  raise notice 'bus live view behavioural checks: all passed';
end
$$;

rollback;

do $$
begin
  if exists (select 1 from schools where slug in ('busview-a', 'busview-b'))
     or exists (select 1 from auth.users where email like 'busview-%@example.invalid') then
    raise exception 'LEAK DETECTED: bus-live-view test fixtures were not rolled back -- fix this test file before trusting it again';
  end if;
end
$$;
