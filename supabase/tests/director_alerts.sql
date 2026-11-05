-- Behavioural test for WP 3.2 (migration *_wp_3_2_director_alerts_core). Rollback-only, synthetic fixtures (fake
-- 0700000xxx numbers), real role impersonation. One transaction ending in `rollback;`, then a leak tripwire.
-- Checks: both flags needed, consent layer reused (revoked number gets nothing), large payment once per payment,
-- quiet hours, daily cap, collection drop, low attendance (needs enough marked), settings get/save + ranges,
-- mark sent once, grants (only service_role may evaluate/mark).
--   psql "$SUPABASE_DB_URL" -v ON_ERROR_STOP=1 -f supabase/tests/director_alerts.sql
begin;

do $$
declare
  sa uuid := gen_random_uuid();
  u_o uuid := gen_random_uuid(); u_g uuid := gen_random_uuid(); su_o uuid := gen_random_uuid(); su_g uuid := gen_random_uuid();
  r_o uuid; r_p uuid; ay uuid := gen_random_uuid(); cl uuid := gen_random_uuid(); st uuid := gen_random_uuid();
  f_dir uuid; f_alert uuid; s_id uuid; i integer;
  v_day date := (now() at time zone 'Africa/Nairobi')::date;
  noon timestamptz; night timestamptz;
  v_n integer; v_n2 integer; v_n3 integer; v_type text; v_json jsonb; v_failed boolean; v_log uuid; v_pay uuid;
begin
  noon := (v_day + time '12:00') at time zone 'Africa/Nairobi';
  night := (v_day + time '21:00') at time zone 'Africa/Nairobi';
  select id into r_o from roles where name = 'school_owner';
  select id into r_p from roles where name = 'parent';
  select id into f_dir from platform_feature_flags where key = 'feature.bot.director';
  select id into f_alert from platform_feature_flags where key = 'feature.bot.director_alerts';
  assert f_dir is not null and f_alert is not null, 'flag catalog entries exist';
  assert not exists (select 1 from school_feature_flags where flag_id = f_alert and enabled), 'alerts flag off everywhere';

  insert into schools (id, name, slug, application_number_prefix) values (sa, 'DAlert Test', 'dalert-test-a', 'DAT');
  insert into auth.users (id, aud, role, email) values
    (u_o, 'authenticated', 'authenticated', 'da-o@example.invalid'), (u_g, 'authenticated', 'authenticated', 'da-g@example.invalid');
  insert into school_users (id, school_id, auth_user_id, role_id, full_name, status, phone) values
    (su_o, sa, u_o, r_o, 'DA Owner', 'active', '0700000111'), (su_g, sa, u_g, r_p, 'DA Parent', 'active', '0700000222');
  insert into academic_years (id, school_id, name, start_date, end_date) values (ay, sa, '2026', date '2026-01-01', date '2026-12-31');
  insert into classes (id, school_id, academic_year_id, name, level_order) values (cl, sa, ay, 'C1', 1);
  insert into streams (id, school_id, class_id, name) values (st, sa, cl, 'S1');
  -- 10 active learners; 9 marked today: 6 present, 3 absent
  for i in 1..10 loop
    insert into students (school_id, first_name, last_name, date_of_birth, gender, status) values (sa, 'K' || i, 'T', date '2012-01-01', 'male', 'approved') returning id into s_id;
    insert into student_guardians (student_id, guardian_user_id, relationship, primary_contact) values (s_id, su_g, 'guardian', true);
    update students set status = 'enrolled' where id = s_id;
    update students set status = 'active' where id = s_id;
    if i <= 9 then
      insert into student_attendance (school_id, student_id, stream_id, attendance_date, status)
      values (sa, s_id, st, v_day, case when i <= 6 then 'present' else 'absent' end);
    end if;
  end loop;
  insert into director_whatsapp_numbers (school_id, school_user_id, phone, consent_text) values (sa, su_o, '+254700000111', 'test opt-in');
  insert into director_alert_settings (school_id, max_per_day) values (sa, 10);

  -- 1. flags: nothing without both
  insert into payments (school_id, method, amount, recorded_at, status) values (sa, 'mpesa', 60000, noon - interval '1 hour', 'unallocated');
  select count(*) into v_n from director_alerts_evaluate(noon);
  assert v_n = 0, '1: both flags off -> nothing';
  insert into school_feature_flags (school_id, flag_id, enabled) values (sa, f_alert, true);
  select count(*) into v_n from director_alerts_evaluate(noon);
  assert v_n = 0, '1: only the alerts flag on (director flag off) -> nothing';
  insert into school_feature_flags (school_id, flag_id, enabled) values (sa, f_dir, true);

  -- 2. large payment: only the 60000 one (>= 50000), once
  insert into payments (school_id, method, amount, recorded_at, status) values (sa, 'cash', 10000, noon - interval '2 hours', 'unallocated');
  -- one evaluation logs everything that is due: the 60000 payment (not the 10000 one) and low attendance (9 of 10 marked, 6 of 9 present)
  select count(*) filter (where alert_type = 'large_payment'), count(*) filter (where alert_type = 'low_attendance'), count(*)
    into v_n, v_n2, v_n3 from director_alerts_evaluate(noon);
  assert v_n = 1, '2: exactly one large-payment alert';
  assert v_n2 = 1, '5: low attendance alert (9 of 10 marked, 67 percent present, floor 85)';
  assert v_n3 = 2, '2: nothing else was due';
  assert exists (select 1 from director_alert_log where school_user_id = su_o and alert_type = 'large_payment' and status = 'would_send'), '2: logged as would_send';
  select count(*) into v_n from director_alerts_evaluate(noon) where alert_type = 'large_payment';
  assert v_n = 0, '2: same payment never alerts twice';

  -- 3. quiet hours: new payment at 20:30, evaluated at 21:00 -> nothing and nothing logged; at noon the next check it alerts
  insert into payments (school_id, method, amount, recorded_at, status) values (sa, 'mpesa', 70000, night - interval '30 minutes', 'unallocated') returning id into v_pay;
  select count(*) into v_n from director_alerts_evaluate(night);
  assert v_n = 0, '3: quiet hours -> nothing';
  assert not exists (select 1 from director_alert_log where dedupe_key = 'pay:' || v_pay::text), '3: nothing logged in quiet hours';
  select count(*) into v_n from director_alerts_evaluate(night + interval '11 hours') where alert_type = 'large_payment';
  assert v_n = 1, '3: alert goes out once quiet hours end';

  -- 4. collection drop: 100000 in the previous 7 days, nothing in the last 7 -> alert
  insert into payments (school_id, method, amount, recorded_at, status) values (sa, 'mpesa', 100000, (v_day - 10 + time '12:00') at time zone 'Africa/Nairobi', 'unallocated');
  select count(*) into v_n from director_alerts_evaluate(noon);
  assert v_n = 1, '4: exactly one new alert (collection drop); low attendance is once per day';
  select count(*) into v_n from director_alerts_evaluate(noon);
  assert v_n = 0, '4: nothing fires twice';

  delete from director_alert_log where alert_type = 'low_attendance';
  update student_attendance set attendance_date = v_day - 1 where school_id = sa and student_id in (select id from students where school_id = sa order by first_name limit 5);
  select count(*) into v_n from director_alerts_evaluate(noon) where alert_type = 'low_attendance';
  assert v_n = 0, '6: too few marked -> no alert';

  -- 7. settings via the real role
  execute 'set local role authenticated';
  perform set_config('request.jwt.claims', json_build_object('sub', u_o, 'role', 'authenticated')::text, true);
  v_json := director_alert_settings_get();
  assert (v_json ->> 'eligible')::boolean and (v_json ->> 'max_per_day')::int = 10, '7: owner reads settings';
  assert (director_alert_settings_save(true, 25000, true, 30, true, 85, 80, time '20:00', time '07:00', 5) ->> 'status') = 'saved', '7: owner saves';
  v_failed := false;
  begin perform director_alert_settings_save(true, 25000, true, 99, true, 85, 80, time '20:00', time '07:00', 5);
  exception when check_violation then v_failed := true; end;
  assert v_failed, '7: out-of-range value refused';
  perform set_config('request.jwt.claims', json_build_object('sub', u_g, 'role', 'authenticated')::text, true);
  assert not (director_alert_settings_get() ->> 'eligible')::boolean, '7: a parent is not eligible';
  v_failed := false;
  begin perform director_alert_settings_save(true, 25000, true, 30, true, 85, 80, time '20:00', time '07:00', 5);
  exception when insufficient_privilege then v_failed := true; end;
  assert v_failed, '7: a parent cannot save';
  execute 'reset role';

  -- 8. daily cap: max_per_day = 1 and one alert already logged today -> a new big payment is held back
  update director_alert_settings set max_per_day = 1 where school_id = sa;
  insert into payments (school_id, method, amount, recorded_at, status) values (sa, 'mpesa', 90000, noon - interval '10 minutes', 'unallocated');
  select count(*) into v_n from director_alerts_evaluate(noon) where alert_type = 'large_payment';
  assert v_n = 0, '8: daily cap holds alerts back';

  -- 9. revoked number: nothing, ever
  update director_whatsapp_numbers set status = 'revoked', revoked_at = now() where school_user_id = su_o;
  update director_alert_settings set max_per_day = 10 where school_id = sa;
  select count(*) into v_n from director_alerts_evaluate(noon);
  assert v_n = 0, '9: revoked registration gets nothing';

  -- 10. mark sent once
  select id into v_log from director_alert_log where school_user_id = su_o limit 1;
  assert director_alert_mark(v_log, 'sent') = true, '10: would_send -> sent';
  assert director_alert_mark(v_log, 'sent') = false, '10: only once';

  -- 11. grants
  assert not has_function_privilege('anon', 'public.director_alerts_evaluate(timestamptz)', 'execute'), '11: anon evaluate';
  assert not has_function_privilege('authenticated', 'public.director_alerts_evaluate(timestamptz)', 'execute'), '11: authenticated evaluate';
  assert has_function_privilege('service_role', 'public.director_alerts_evaluate(timestamptz)', 'execute'), '11: service_role evaluate';
  assert not has_function_privilege('authenticated', 'public.director_alert_mark(uuid,text)', 'execute'), '11: authenticated mark';
  assert not has_function_privilege('authenticated', 'public.director_alert_try_log(uuid,uuid,text,text,integer,timestamptz)', 'execute'), '11: internal helper';
  assert not has_function_privilege('anon', 'public.director_alert_settings_get()', 'execute'), '11: anon settings';
  assert not has_table_privilege('authenticated', 'public.director_alert_log', 'select'), '11: log table closed';

  raise notice 'director alerts behavioural checks: all passed';
end
$$;

rollback;

do $$
begin
  if exists (select 1 from schools where slug = 'dalert-test-a')
     or exists (select 1 from auth.users where email like 'da-%@example.invalid') then
    raise exception 'LEAK DETECTED: director-alerts test fixtures were not rolled back -- fix this test file before trusting it again';
  end if;
end
$$;
