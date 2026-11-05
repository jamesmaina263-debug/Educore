-- Behavioural test for WP 5.4 + 5.5 (migration *_bus_guardian_alerts). Rollback-only, synthetic fixtures.
--   psql "$SUPABASE_DB_URL" -v ON_ERROR_STOP=1 -f supabase/tests/bus_guardian_alerts.sql
-- Runs the REAL deployed functions and policies with real role impersonation. It only ever flips flags and
-- settings on its own fixture schools and never asserts anything about real schools, so a school switching this
-- feature on in production cannot make it fail. Nothing it does is kept: one transaction ending in `rollback;`
-- plus a leak tripwire in its own transaction. No SMS is ever sent: it only inserts notification_logs rows that
-- the rollback discards.
begin;

-- Run SQL as a signed-in user and say whether it failed with the expected SQLSTATE.
create function pg_temp.raises_as(p_uid uuid, p_sql text, p_code text) returns boolean language plpgsql as $f$
declare v boolean;
begin
  execute 'set local role authenticated';
  perform set_config('request.jwt.claims', json_build_object('sub', p_uid, 'role', 'authenticated')::text, true);
  begin
    execute p_sql;
    v := false;
  exception when others then
    v := (sqlstate = p_code);
  end;
  execute 'reset role';
  return v;
end $f$;

-- Run an expression (returning a value) as a signed-in user and return it as jsonb.
create function pg_temp.val_as(p_uid uuid, p_expr text) returns jsonb language plpgsql as $f$
declare v jsonb;
begin
  execute 'set local role authenticated';
  perform set_config('request.jwt.claims', json_build_object('sub', p_uid, 'role', 'authenticated')::text, true);
  execute 'select to_jsonb(' || p_expr || ')' into v;
  execute 'reset role';
  return v;
end $f$;

-- Run a statement (e.g. a void function call) as a signed-in user.
create function pg_temp.run_as(p_uid uuid, p_sql text) returns void language plpgsql as $f$
begin
  execute 'set local role authenticated';
  perform set_config('request.jwt.claims', json_build_object('sub', p_uid, 'role', 'authenticated')::text, true);
  execute p_sql;
  execute 'reset role';
end $f$;

do $$
declare
  sa uuid := gen_random_uuid(); sb uuid := gen_random_uuid();
  u_tm uuid := gen_random_uuid(); u_dep uuid := gen_random_uuid(); u_p1 uuid := gen_random_uuid();
  u_p2 uuid := gen_random_uuid(); u_p3 uuid := gen_random_uuid(); u_tmb uuid := gen_random_uuid();
  r_tm uuid; r_dep uuid; r_par uuid;
  su_p1 uuid; su_p2 uuid; su_p3 uuid;
  f uuid;
  rt_n uuid := gen_random_uuid(); rt_b uuid := gen_random_uuid();
  v_n uuid := gen_random_uuid(); v_b uuid := gen_random_uuid();
  st_ann uuid := gen_random_uuid(); st_ben uuid := gen_random_uuid(); st_cy uuid := gen_random_uuid();
  st_fay uuid := gen_random_uuid(); st_zed uuid := gen_random_uuid();
  res jsonb; n bigint; ev uuid; tlog uuid;
  tphone text := '0712345678';
begin
  select id into r_tm from roles where name = 'transport_manager';
  select id into r_dep from roles where name = 'deputy_principal';
  select id into r_par from roles where name = 'parent';
  assert r_tm is not null and r_dep is not null and r_par is not null, 'fixture roles exist';
  select id into f from platform_feature_flags where key = 'feature.transport.guardian_alerts';
  assert f is not null, 'flag is in the catalog';

  insert into auth.users (id, aud, role, email) values
    (u_tm, 'authenticated', 'authenticated', 'busalert-tm@example.invalid'),
    (u_dep, 'authenticated', 'authenticated', 'busalert-dep@example.invalid'),
    (u_p1, 'authenticated', 'authenticated', 'busalert-p1@example.invalid'),
    (u_p2, 'authenticated', 'authenticated', 'busalert-p2@example.invalid'),
    (u_p3, 'authenticated', 'authenticated', 'busalert-p3@example.invalid'),
    (u_tmb, 'authenticated', 'authenticated', 'busalert-tmb@example.invalid');
  insert into schools (id, name, slug, application_number_prefix) values (sa, 'BusAlert A', 'busalert-a', 'BAA'), (sb, 'BusAlert B', 'busalert-b', 'BAB');
  insert into school_users (auth_user_id, school_id, role_id, full_name, status) values
    (u_tm, sa, r_tm, 'TM A', 'active'), (u_dep, sa, r_dep, 'Deputy A', 'active'), (u_tmb, sb, r_tm, 'TM B', 'active');
  insert into school_users (auth_user_id, school_id, role_id, full_name, status, phone) values (u_p1, sa, r_par, 'Parent One', 'active', '0711000001') returning id into su_p1;
  insert into school_users (auth_user_id, school_id, role_id, full_name, status, phone) values (u_p2, sa, r_par, 'Parent Two', 'active', '0711000002') returning id into su_p2;
  insert into school_users (auth_user_id, school_id, role_id, full_name, status, phone) values (u_p3, sa, r_par, 'Parent Three', 'active', null) returning id into su_p3;

  insert into transport_routes (id, school_id, name) values (rt_n, sa, 'North Route'), (rt_b, sb, 'B Route');
  insert into transport_vehicles (id, school_id, registration_number, capacity, route_id, driver_name, driver_phone) values
    (v_n, sa, 'KAA 100A', 40, rt_n, 'Driver N', '0700000001'), (v_b, sb, 'KBB 900Z', 40, rt_b, null, null);
  insert into students (id, school_id, first_name, last_name, date_of_birth, gender, status) values
    (st_ann, sa, 'Ann', 'Alpha', date '2012-01-01', 'female', 'approved'), (st_ben, sa, 'Ben', 'Bravo', date '2012-01-02', 'male', 'approved'),
    (st_cy, sa, 'Cy', 'Charlie', date '2012-01-03', 'male', 'approved'), (st_fay, sa, 'Fay', 'Foxtrot', date '2012-01-06', 'female', 'approved'),
    (st_zed, sb, 'Zed', 'Zulu', date '2012-01-07', 'male', 'approved');
  -- Ann: guardians Parent One (phone) and Parent Three (no phone). Ben: Parent Two. Cy: Parent One. Fay: no assignment.
  insert into student_guardians (student_id, guardian_user_id, relationship) values
    (st_ann, su_p1, 'mother'), (st_ann, su_p3, 'father'), (st_ben, su_p2, 'father'), (st_cy, su_p1, 'mother');
  insert into student_transport_assignments (school_id, student_id, route_id, vehicle_id, status, start_date, end_date) values
    (sa, st_ann, rt_n, v_n, 'active', current_date - 30, null), (sa, st_ben, rt_n, v_n, 'active', current_date - 30, null),
    (sa, st_cy, rt_n, null, 'active', current_date - 30, null), (sb, st_zed, rt_b, v_b, 'active', current_date - 30, null);

  -- ===== 1. flag off: everything refuses =====
  assert pg_temp.raises_as(u_tm, format('select set_bus_alert_mode(%L, %L)', 'test', tphone), '55000'), '1a: mode refused with flag off';
  assert pg_temp.raises_as(u_tm, format('select record_bus_boarding(%L, %L)', st_ann, 'boarded'), '55000'), '1b: boarding refused with flag off';
  assert pg_temp.raises_as(u_tm, format('select send_bus_delay_alert(%L, 20, null)', rt_n), '55000'), '1c: delay refused with flag off';
  assert pg_temp.raises_as(u_p1, 'select set_my_bus_alerts(false)', '55000'), '1d: guardian opt-out refused with flag off';
  assert pg_temp.raises_as(u_tm, 'select * from bus_boarding_reconciliation(null)', '55000'), '1e: reconciliation refused with flag off';

  insert into school_feature_flags (school_id, flag_id, enabled) values (sa, f, true);

  -- ===== 2. permissions =====
  assert pg_temp.raises_as(u_dep, format('select set_bus_alert_mode(%L, %L)', 'test', tphone), '42501'), '2a: read-only role cannot change settings';
  assert pg_temp.raises_as(u_p1, format('select record_bus_boarding(%L, %L)', st_ann, 'boarded'), '42501'), '2b: parent cannot record boarding';
  assert pg_temp.raises_as(u_p1, format('select send_bus_delay_alert(%L, 20, null)', rt_n), '42501'), '2c: parent cannot send delay alerts';
  assert pg_temp.raises_as(u_p1, 'select * from bus_boarding_reconciliation(null)', '42501'), '2d: parent cannot run reconciliation';

  -- ===== 3. mode rules: test phone first, live only after a test =====
  assert pg_temp.raises_as(u_tm, format('select set_bus_alert_mode(%L, null)', 'test'), '22023'), '3a: test mode needs a phone';
  assert pg_temp.raises_as(u_tm, format('select set_bus_alert_mode(%L, %L)', 'test', '12'), '22023'), '3b: bad phone refused';
  assert pg_temp.raises_as(u_tm, format('select set_bus_alert_mode(%L, %L)', 'whatever', tphone), '22023'), '3c: bad mode refused';
  assert pg_temp.raises_as(u_tm, format('select set_bus_alert_mode(%L, %L)', 'live', tphone), '22023'), '3d: live refused before any test';
  begin
    insert into bus_alert_settings (school_id, mode, test_phone) values (sa, 'live', tphone);
    assert false, '3e: table constraint must refuse live without a test';
  exception when check_violation then null;
  end;

  -- ===== 4. mode off (no settings): boarding is recorded, nothing is queued, delay refuses =====
  assert pg_temp.raises_as(u_tm, format('select send_bus_delay_alert(%L, 20, null)', rt_n), '55000'), '4a: delay refused while off';
  res := pg_temp.val_as(u_tm, format('record_bus_boarding(%L, %L)', st_ann, 'boarded'));
  assert res->>'mode' = 'off' and (res->>'queued')::int = 0 and res->>'event_id' is not null, '4b: off records the event, queues nothing';
  select count(*) into n from notification_logs where school_id = sa and source_module = 'bus_alert';
  assert n = 0, '4c: off queued no messages';
  assert pg_temp.raises_as(u_tm, format('select record_bus_boarding(%L, %L)', st_ann, 'boarded'), 'P0001'), '4d: repeat within 10 minutes refused';

  -- ===== 5. test mode: ONE message to the staff phone, never a guardian =====
  perform pg_temp.run_as(u_tm, format('select set_bus_alert_mode(%L, %L)', 'test', '0712 345-678'));
  assert (select test_phone from bus_alert_settings where school_id = sa) = tphone, '5a: phone normalised';
  res := pg_temp.val_as(u_tm, format('send_bus_delay_alert(%L, 20, %L)', rt_n, 'Traffic on the highway'));
  assert res->>'mode' = 'test' and (res->>'queued')::int = 1 and (res->>'guardians')::int = 3, '5b: test delay counts 3 guardians, queues 1';
  select count(*) into n from notification_logs where school_id = sa and source_module = 'bus_alert' and recipient_type = 'guardian';
  assert n = 0, '5c: test mode never queues a guardian message';
  select count(*) into n from notification_logs where school_id = sa and source_module = 'bus_alert' and recipient_type = 'staff'
     and recipient_phone = tphone and body like '[TEST] %3 guardians%' and body like '%20 minutes late%' and body like '%Traffic on the highway%';
  assert n = 1, '5d: one staff test message with the preview';
  assert pg_temp.raises_as(u_tm, format('select send_bus_delay_alert(%L, 25, null)', rt_n), 'P0001'), '5e: repeat delay within 10 minutes refused';
  res := pg_temp.val_as(u_tm, format('record_bus_boarding(%L, %L)', st_ben, 'boarded'));
  assert res->>'mode' = 'test' and (res->>'queued')::int = 1, '5f: test boarding queues 1';
  select count(*) into n from notification_logs where school_id = sa and source_module = 'bus_alert' and recipient_type = 'guardian';
  assert n = 0, '5g: still no guardian message in test mode';

  -- ===== 6. live needs a test; changing the phone resets the test =====
  assert pg_temp.raises_as(u_tm, format('select set_bus_alert_mode(%L, null)', 'live'), '22023'), '6a: live refused until a test alert was queued';
  assert pg_temp.raises_as(u_dep, 'select send_bus_test_alert()', '42501'), '6b: read-only role cannot send a test';
  tlog := (pg_temp.val_as(u_tm, 'send_bus_test_alert()') #>> '{}')::uuid;
  assert tlog is not null and (select test_sent_at from bus_alert_settings where school_id = sa) is not null, '6c: test queued and recorded';
  perform pg_temp.run_as(u_tm, format('select set_bus_alert_mode(%L, null)', 'live'));
  assert (select mode from bus_alert_settings where school_id = sa) = 'live', '6d: live allowed after a test';
  assert pg_temp.raises_as(u_tm, format('select set_bus_alert_mode(%L, %L)', 'live', '0799999999'), '22023'), '6e: a new test phone must be tested before live';
  perform pg_temp.run_as(u_tm, format('select set_bus_alert_mode(%L, null)', 'live'));  -- unchanged phone still live

  -- ===== 7. live: opt-out, missing phone, quiet hours =====
  -- The 10-minute repeat guard looks at created_at, which is the transaction start, so push earlier alerts just
  -- outside the window. Events are NOT moved (the guard is per learner and kind, and moving them could cross
  -- midnight and break the same-day reconciliation below).
  update bus_alerts set created_at = created_at - interval '11 minutes' where school_id = sa;
  update bus_alert_settings set quiet_start = time '00:00', quiet_end = time '00:00' where school_id = sa;  -- quiet hours off
  perform pg_temp.run_as(u_p2, 'select set_my_bus_alerts(false)');
  assert (select enabled from bus_alert_preferences where school_user_id = su_p2) = false, '7a: opt-out stored';
  res := pg_temp.val_as(u_tm, format('send_bus_delay_alert(%L, 30, null)', rt_n));
  assert res->>'mode' = 'live' and (res->>'queued')::int = 1 and (res->>'skipped_opt_out')::int = 1 and (res->>'skipped_no_phone')::int = 1, '7b: live delay: 1 queued, 1 opted out, 1 no phone';
  select count(*) into n from notification_logs where school_id = sa and source_module = 'bus_alert' and recipient_type = 'guardian' and recipient_phone = '0711000001';
  assert n = 1, '7c: only Parent One was messaged';
  select count(*) into n from notification_logs where school_id = sa and source_module = 'bus_alert' and recipient_type = 'guardian' and recipient_phone = '0711000002';
  assert n = 0, '7d: the opted-out guardian got nothing';
  assert (select count(*) from bus_alerts where school_id = sa and mode = 'live' and kind = 'delay' and outcome = 'skipped_opt_out') = 1
     and (select count(*) from bus_alerts where school_id = sa and mode = 'live' and kind = 'delay' and outcome = 'skipped_no_phone') = 1, '7e: skips are logged';
  res := pg_temp.val_as(u_tm, format('record_bus_boarding(%L, %L)', st_cy, 'boarded'));
  assert res->>'mode' = 'live' and (res->>'queued')::int = 1, '7f: live boarding queues for Parent One';
  select count(*) into n from notification_logs where school_id = sa and source_module = 'bus_alert' and recipient_type = 'guardian' and body like '%: Cy boarded the school bus at __:__.';
  assert n = 1, '7g: boarding message names the child and time only';
  perform pg_temp.run_as(u_p2, 'select set_my_bus_alerts(true)');
  assert (select enabled from bus_alert_preferences where school_user_id = su_p2) = true, '7h: opt back in';

  -- quiet hours: a window around "now" holds every live message but still records the event
  update bus_alert_settings set quiet_start = ((now() at time zone 'Africa/Nairobi')::time - interval '1 hour')::time,
                                quiet_end = ((now() at time zone 'Africa/Nairobi')::time + interval '1 hour')::time where school_id = sa;
  res := pg_temp.val_as(u_tm, format('record_bus_boarding(%L, %L)', st_ann, 'dropped_off'));
  assert (res->>'queued')::int = 0 and (res->>'skipped_quiet_hours')::int = 2 and res->>'event_id' is not null, '7i: quiet hours skip both guardians, event still recorded';
  select count(*) into n from notification_logs where school_id = sa and source_module = 'bus_alert' and body like '%Ann got off the school bus%';
  assert n = 0, '7j: nothing queued in quiet hours';

  -- ===== 8. validation =====
  assert pg_temp.raises_as(u_tm, format('select send_bus_delay_alert(%L, 4, null)', rt_n), '22023'), '8a: delay under 5 minutes refused';
  assert pg_temp.raises_as(u_tm, format('select send_bus_delay_alert(%L, 181, null)', rt_n), '22023'), '8b: delay over 180 minutes refused';
  assert pg_temp.raises_as(u_tm, format('select send_bus_delay_alert(%L, 30, %L)', rt_n, repeat('x', 121)), '22023'), '8c: long note refused';
  assert pg_temp.raises_as(u_tm, format('select send_bus_delay_alert(%L, 30, %L)', rt_n, 'a' || chr(10) || 'b'), '22023'), '8d: line break in note refused';
  assert pg_temp.raises_as(u_tm, format('select send_bus_delay_alert(%L, 30, null)', rt_b), 'P0002'), '8e: another school''s route refused';
  assert pg_temp.raises_as(u_tm, format('select send_bus_delay_alert(%L, 30, null)', gen_random_uuid()), 'P0002'), '8f: unknown route refused';
  assert pg_temp.raises_as(u_tm, format('select record_bus_boarding(%L, %L)', st_ann, 'teleported'), '22023'), '8g: bad kind refused';
  assert pg_temp.raises_as(u_tm, format('select record_bus_boarding(%L, %L)', st_fay, 'boarded'), 'P0002'), '8h: learner with no assignment refused';
  assert pg_temp.raises_as(u_tm, format('select record_bus_boarding(%L, %L)', st_zed, 'boarded'), 'P0002'), '8i: another school''s learner refused';

  -- ===== 9. reconciliation (read-only) =====
  res := pg_temp.val_as(u_dep, 'coalesce((select jsonb_agg(to_jsonb(r) order by r.student_name) from bus_boarding_reconciliation(null) r), ''[]''::jsonb)');
  assert jsonb_array_length(res) = 3, '9a: three assigned learners, not Fay and not another school''s';
  assert (select (e->>'boarded')::boolean from jsonb_array_elements(res) e where e->>'student_name' = 'Ann Alpha'), '9b: Ann boarded recorded';
  assert (select (e->>'dropped_off')::boolean from jsonb_array_elements(res) e where e->>'student_name' = 'Ann Alpha'), '9c: Ann drop-off recorded';
  assert (select (e->>'boarded')::boolean from jsonb_array_elements(res) e where e->>'student_name' = 'Ben Bravo'), '9d: Ben boarded recorded';
  assert not (select (e->>'dropped_off')::boolean from jsonb_array_elements(res) e where e->>'student_name' = 'Cy Charlie'), '9d2: Cy has no drop-off yet';
  assert not exists (select 1 from jsonb_array_elements(res) e where e->>'student_name' in ('Fay Foxtrot', 'Zed Zulu')), '9d3: unassigned and other-school learners are not listed';
  assert not exists (select 1 from jsonb_array_elements(res) e where (e->>'gate_in')::boolean or (e->>'gate_out')::boolean), '9e: no gate scans in fixtures';

  -- ===== 10. isolation and read access =====
  assert pg_temp.val_as(u_tm, 'coalesce((select count(*) from bus_alerts), 0)')::text::int > 0, '10a: own school staff see the log';
  assert pg_temp.val_as(u_tmb, 'coalesce((select count(*) from bus_alerts), 0)')::text::int = 0, '10b: other school sees none';
  assert pg_temp.val_as(u_tmb, 'coalesce((select count(*) from bus_boarding_events), 0)')::text::int = 0, '10c: other school sees no events';
  assert pg_temp.val_as(u_p1, 'coalesce((select count(*) from bus_alerts), 0)')::text::int = 0, '10d: a parent cannot read the alert log';
  assert pg_temp.val_as(u_p1, 'coalesce((select count(*) from bus_boarding_events), 0)')::text::int = 0, '10e: a parent cannot read boarding events';
  assert pg_temp.val_as(u_p2, 'coalesce((select count(*) from bus_alert_preferences), 0)')::text::int = 1, '10f: a parent reads only their own preference';
  assert pg_temp.val_as(u_p1, 'coalesce((select count(*) from bus_alert_preferences), 0)')::text::int = 0, '10g: another parent''s preference is hidden';
  assert pg_temp.val_as(u_dep, 'coalesce((select count(*) from bus_alert_settings), 0)')::text::int = 1, '10h: read-only staff can see settings';
  assert pg_temp.val_as(u_p1, 'coalesce((select count(*) from bus_alert_settings), 0)')::text::int = 0, '10i: a parent cannot see settings or the test phone';

  -- ===== 11. no direct writes =====
  assert pg_temp.raises_as(u_tm, format('insert into bus_alerts (school_id, kind, mode, outcome) values (%L, %L, %L, %L)', sa, 'delay', 'live', 'queued'), '42501'), '11a: direct insert into bus_alerts refused';
  assert pg_temp.raises_as(u_tm, format('insert into bus_boarding_events (school_id, student_id, route_id, kind) values (%L, %L, %L, %L)', sa, st_ann, rt_n, 'boarded'), '42501'), '11b: direct insert into events refused';
  assert pg_temp.raises_as(u_tm, format('insert into bus_alert_settings (school_id, mode) values (%L, %L)', sb, 'test'), '42501'), '11c: direct insert into settings refused';
  assert pg_temp.raises_as(u_p1, format('insert into bus_alert_preferences (school_user_id, school_id, enabled) values (%L, %L, false)', su_p3, sa), '42501'), '11d: direct insert into preferences refused';
  perform pg_temp.run_as(u_tm, format('update bus_alerts set outcome = %L where school_id = %L', 'skipped_opt_out', sa));
  assert (select count(*) from bus_alerts where school_id = sa and outcome = 'skipped_opt_out') = 1, '11e: direct update changed nothing';
  perform pg_temp.run_as(u_tm, format('delete from bus_boarding_events where school_id = %L', sa));
  assert (select count(*) from bus_boarding_events where school_id = sa) >= 4, '11f: direct delete removed nothing';

  -- ===== 12. grants =====
  assert not has_function_privilege('anon', 'public.set_bus_alert_mode(text,text)', 'execute'), '12a: anon cannot set mode';
  assert not has_function_privilege('anon', 'public.send_bus_test_alert()', 'execute'), '12b: anon cannot test';
  assert not has_function_privilege('anon', 'public.send_bus_delay_alert(uuid,integer,text)', 'execute'), '12c: anon cannot send delay';
  assert not has_function_privilege('anon', 'public.record_bus_boarding(uuid,text,uuid)', 'execute'), '12d: anon cannot record boarding';
  assert not has_function_privilege('anon', 'public.set_my_bus_alerts(boolean)', 'execute'), '12e: anon cannot opt out';
  assert not has_function_privilege('anon', 'public.bus_boarding_reconciliation(date)', 'execute'), '12f: anon cannot reconcile';
  assert not has_function_privilege('authenticated', 'public.bus_alert_deliver(uuid,text,uuid,uuid,uuid,text,jsonb,uuid)', 'execute'), '12g: signed-in users cannot call the deliverer directly';
  assert not has_function_privilege('authenticated', 'public.bus_alert_queue_sms(uuid,uuid,uuid,text,text,text,uuid)', 'execute'), '12h: signed-in users cannot queue SMS directly';
  assert not has_function_privilege('authenticated', 'public.bus_alert_in_quiet_hours(time,time)', 'execute'), '12i: quiet-hours helper is internal';

  -- ===== 12b. cancel_unsent_bus_alerts: a failed immediate send must not go out late =====
  assert pg_temp.raises_as(u_p1, 'select cancel_unsent_bus_alerts()', '42501'), '12b-a: a parent cannot cancel alerts';
  assert pg_temp.raises_as(u_dep, 'select cancel_unsent_bus_alerts()', '42501'), '12b-b: read-only staff cannot cancel alerts';
  assert not has_function_privilege('anon', 'public.cancel_unsent_bus_alerts()', 'execute'), '12b-c: anon cannot cancel';
  -- an unrelated module's queued message in the same school must be left alone
  insert into notification_logs (school_id, recipient_phone, recipient_type, channel, body, segments, source_module)
    values (sa, '0711000009', 'guardian', 'sms', 'Fee reminder (not a bus alert)', 1, 'fee_reminder');
  select count(*) into n from notification_logs where school_id = sa and source_module = 'bus_alert' and status = 'queued';
  assert n > 0, '12b-d: there are queued bus alerts to cancel';
  assert (pg_temp.val_as(u_tm, 'cancel_unsent_bus_alerts()') #>> '{}')::int = n, '12b-e: cancels exactly the queued bus alerts';
  select count(*) into n from notification_logs where school_id = sa and source_module = 'bus_alert' and status = 'queued';
  assert n = 0, '12b-f: none left queued';
  select count(*) into n from notification_logs where school_id = sa and source_module = 'bus_alert' and status = 'failed' and provider_response like 'Cancelled:%';
  assert n > 0, '12b-g: cancelled rows say why';
  select count(*) into n from notification_logs where school_id = sa and source_module = 'fee_reminder' and status = 'queued';
  assert n = 1, '12b-h: another module''s queued message is untouched';
  assert (pg_temp.val_as(u_tm, 'cancel_unsent_bus_alerts()') #>> '{}')::int = 0, '12b-i: a second call cancels nothing';
  assert pg_temp.raises_as(u_tmb, 'select cancel_unsent_bus_alerts()', '55000'), '12b-j: a school without the flag is refused';

  -- ===== 13. flag off again hides everything, even from the school's own staff =====
  update school_feature_flags set enabled = false where school_id = sa and flag_id = f;
  assert pg_temp.val_as(u_tm, 'coalesce((select count(*) from bus_alerts), 0)')::text::int = 0, '13a: flag off hides the log';
  assert pg_temp.raises_as(u_tm, format('select send_bus_delay_alert(%L, 30, null)', rt_n), '55000'), '13b: flag off refuses sending';

  raise notice 'bus_guardian_alerts behavioural checks: all passed';
end $$;

rollback;

-- Independent tripwire in its own transaction.
do $$
begin
  if exists (select 1 from schools where slug in ('busalert-a', 'busalert-b'))
     or exists (select 1 from auth.users where email like 'busalert-%@example.invalid') then
    raise exception 'LEAK DETECTED: bus_guardian_alerts fixtures were not rolled back';
  end if;
end $$;
