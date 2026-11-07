-- Behavioural test for WP 3.5 (migration *_wp_3_5_same_day_absence_core). Rollback-only, synthetic fixtures (fake 0700000xxx
-- numbers), real role impersonation. One transaction ending in `rollback;`, then a leak tripwire.
-- Checks: both locks (flag + school switch), Monday-Friday only, cut-off and 3-hour window, absent-on-the-class-register only,
-- a correction before the run means no alert, guardian without a usable phone skipped, opt-out respected, once per learner per day,
-- settings roles and ranges, mark, grants. Nothing is ever sent.
--   psql "$SUPABASE_DB_URL" -v ON_ERROR_STOP=1 -f supabase/tests/same_day_absence.sql
begin;

do $$
declare
  sa uuid := gen_random_uuid();
  u_p uuid := gen_random_uuid(); u_t uuid := gen_random_uuid();
  su_p uuid := gen_random_uuid(); su_t uuid := gen_random_uuid();
  g1 uuid := gen_random_uuid(); g2 uuid := gen_random_uuid(); g3 uuid := gen_random_uuid();
  r_p uuid; r_t uuid; r_par uuid; ay uuid := gen_random_uuid(); cl uuid := gen_random_uuid(); st uuid := gen_random_uuid();
  flag uuid; s1 uuid; s2 uuid; s3 uuid; s4 uuid; s5 uuid; s6 uuid;
  mon_before timestamptz := timestamptz '2026-03-02 09:30+03';
  mon_ok timestamptz := timestamptz '2026-03-02 10:30+03';
  mon_late timestamptz := timestamptz '2026-03-02 13:30+03';
  sat timestamptz := timestamptz '2026-03-07 10:30+03';
  v_n integer; v_phone text; v_json jsonb; v_failed boolean; v_log uuid;
begin
  select id into r_p from roles where name = 'principal';
  select id into r_t from roles where name = 'teacher';
  select id into r_par from roles where name = 'parent';
  select id into flag from platform_feature_flags where key = 'feature.attendance.same_day_absence';
  assert flag is not null, '0: flag in the catalog';

  insert into schools (id, name, slug, application_number_prefix) values (sa, 'SDA Test', 'sda-test-a', 'SDT');
  insert into auth.users (id, aud, role, email) values
    (u_p, 'authenticated', 'authenticated', 'sda-p@example.invalid'), (u_t, 'authenticated', 'authenticated', 'sda-t@example.invalid');
  insert into school_users (id, school_id, auth_user_id, role_id, full_name, status, phone) values
    (su_p, sa, u_p, r_p, 'SDA Principal', 'active', '0700000111'), (su_t, sa, u_t, r_t, 'SDA Teacher', 'active', '0700000222');
  insert into school_users (id, school_id, role_id, full_name, status, phone) values
    (g1, sa, r_par, 'SDA Parent One', 'active', '0700000444'),
    (g2, sa, r_par, 'SDA Parent NoPhone', 'active', null),
    (g3, sa, r_par, 'SDA Parent OptOut', 'active', '0700000555');
  insert into academic_years (id, school_id, name, start_date, end_date) values (ay, sa, '2026', date '2026-01-01', date '2026-12-31');
  insert into classes (id, school_id, academic_year_id, name, level_order) values (cl, sa, ay, 'C1', 1);
  insert into streams (id, school_id, class_id, name) values (st, sa, cl, 'S1');

  -- six active learners; guardian per learner as the primary contact
  -- s1 absent today (alert), s2 present, s3 absent but guardian has no phone, s4 absent but guardian opted out,
  -- s5 absent only yesterday, s6 marked absent then corrected to present before the run
  s1 := gen_random_uuid(); s2 := gen_random_uuid(); s3 := gen_random_uuid(); s4 := gen_random_uuid(); s5 := gen_random_uuid(); s6 := gen_random_uuid();
  insert into students (id, school_id, first_name, last_name, date_of_birth, gender, status)
  select x, sa, 'L' || i, 'T', date '2012-01-01', 'male', 'approved' from unnest(array[s1, s2, s3, s4, s5, s6]) with ordinality as t(x, i);
  insert into student_guardians (student_id, guardian_user_id, relationship, primary_contact) values
    (s1, g1, 'guardian', true), (s2, g1, 'guardian', true), (s3, g2, 'guardian', true),
    (s4, g3, 'guardian', true), (s5, g1, 'guardian', true), (s6, g1, 'guardian', true);
  update students set status = 'enrolled' where school_id = sa;
  update students set status = 'active' where school_id = sa;
  insert into student_attendance (school_id, student_id, stream_id, attendance_date, status, session) values
    (sa, s1, st, date '2026-03-02', 'absent', 'class'),
    (sa, s2, st, date '2026-03-02', 'present', 'class'),
    (sa, s3, st, date '2026-03-02', 'absent', 'class'),
    (sa, s4, st, date '2026-03-02', 'absent', 'class'),
    (sa, s5, st, date '2026-03-01', 'absent', 'class'),
    (sa, s6, st, date '2026-03-02', 'absent', 'class');
  update student_attendance set status = 'present', edit_reason = 'test correction' where student_id = s6 and attendance_date = date '2026-03-02';

  -- 1. no settings row -> nothing, even at a good time
  select count(*) into v_n from same_day_absence_evaluate(mon_ok);
  assert v_n = 0, '1: no switch -> nothing';

  -- 2. settings: flag off -> disabled; roles; ranges
  execute 'set local role authenticated';
  perform set_config('request.jwt.claims', json_build_object('sub', u_p, 'role', 'authenticated')::text, true);
  assert (same_day_absence_settings_get())->>'eligible' = 'false', '2: flag off -> not eligible';
  assert (same_day_absence_settings_save(true, time '10:00'))->>'status' = 'disabled', '2: flag off -> disabled';
  execute 'reset role';
  insert into school_feature_flags (school_id, flag_id, enabled) values (sa, flag, true);
  execute 'set local role authenticated';
  perform set_config('request.jwt.claims', json_build_object('sub', u_p, 'role', 'authenticated')::text, true);
  v_json := same_day_absence_settings_get();
  assert (v_json->>'eligible')::boolean and not (v_json->>'enabled')::boolean and v_json->>'cutoff_time' = '10:00:00', '2: default is off at 10:00: ' || v_json::text;
  perform set_config('request.jwt.claims', json_build_object('sub', u_t, 'role', 'authenticated')::text, true);
  v_failed := false; begin perform same_day_absence_settings_save(true, time '10:00'); exception when sqlstate '42501' then v_failed := true; end;
  assert v_failed, '2: a teacher cannot change settings';
  perform set_config('request.jwt.claims', json_build_object('sub', u_p, 'role', 'authenticated')::text, true);
  v_failed := false; begin perform same_day_absence_settings_save(true, time '07:00'); exception when check_violation then v_failed := true; end;
  assert v_failed, '2: cut-off before 08:00 refused';
  v_failed := false; begin perform same_day_absence_settings_save(true, time '15:00'); exception when check_violation then v_failed := true; end;
  assert v_failed, '2: cut-off after 14:00 refused';
  execute 'reset role';
  select count(*) into v_n from same_day_absence_evaluate(mon_ok);
  assert v_n = 0, '2: flag on but school switch off -> nothing';

  -- 3. switch on
  execute 'set local role authenticated';
  perform set_config('request.jwt.claims', json_build_object('sub', u_p, 'role', 'authenticated')::text, true);
  assert (same_day_absence_settings_save(true, time '10:00'))->>'status' = 'saved', '3: saved';
  execute 'reset role';
  perform set_config('request.jwt.claims', '{}', true);

  -- 4. timing: before the cut-off, after the 3-hour window and at the weekend nothing is produced
  select count(*) into v_n from same_day_absence_evaluate(mon_before); assert v_n = 0, '4: before cut-off';
  select count(*) into v_n from same_day_absence_evaluate(mon_late); assert v_n = 0, '4: after the 3-hour window';
  select count(*) into v_n from same_day_absence_evaluate(sat); assert v_n = 0, '4: Saturday';

  -- 5. opt-out recording
  assert same_day_absence_opt_out(sa, '0700000555') = true, '5: opt-out recorded';
  assert same_day_absence_opt_out(sa, '12345') = false, '5: invalid phone not recorded';
  assert same_day_absence_opt_out(sa, '+254 700 000 555') = true, '5: idempotent on the normalised number';
  select count(*) into v_n from same_day_absence_optouts where school_id = sa; assert v_n = 1, '5: one opt-out row';

  -- 6. at 10:30 exactly one alert: s1 (absent, guardian with a phone). s2 present, s3 no phone, s4 opted out, s5 other day, s6 corrected.
  select count(*), min(e.phone), min(e.log_id::text)::uuid into v_n, v_phone, v_log from same_day_absence_evaluate(mon_ok) e;
  assert v_n = 1 and v_phone = '+254700000444', '6: one alert for the right guardian: ' || v_n::text || ' ' || coalesce(v_phone, '-');
  select count(*) into v_n from same_day_absence_log where school_id = sa and student_id = s1 and status = 'would_send';
  assert v_n = 1, '6: logged as would_send';
  select count(*) into v_n from same_day_absence_log where school_id = sa; assert v_n = 1, '6: nothing else logged';

  -- 7. once per learner per day, even if run again inside the window
  select count(*) into v_n from same_day_absence_evaluate(mon_ok + interval '20 minutes'); assert v_n = 0, '7: no second alert';

  -- 8. a later correction does not matter once logged; mark moves would_send to sent once
  assert same_day_absence_mark(v_log, 'sent') = true, '8: marked sent';
  assert same_day_absence_mark(v_log, 'sent') = false, '8: only a would_send row can be marked';
  v_failed := false; begin perform same_day_absence_mark(v_log, 'whatever'); exception when others then v_failed := true; end;
  assert v_failed, '8: bad status refused';

  -- 9. the next school day is a new day: s1 absent again -> alert again (different date key)
  insert into student_attendance (school_id, student_id, stream_id, attendance_date, status, session) values (sa, s1, st, date '2026-03-03', 'absent', 'class');
  select count(*) into v_n from same_day_absence_evaluate(timestamptz '2026-03-03 10:30+03'); assert v_n = 1, '9: next day alerts again';

  -- 10. grants and direct table access
  assert not has_function_privilege('anon', 'public.same_day_absence_evaluate(timestamptz)', 'execute'), '10: anon evaluate';
  assert not has_function_privilege('authenticated', 'public.same_day_absence_evaluate(timestamptz)', 'execute'), '10: authenticated evaluate';
  assert has_function_privilege('service_role', 'public.same_day_absence_evaluate(timestamptz)', 'execute'), '10: service_role evaluate';
  assert not has_function_privilege('authenticated', 'public.same_day_absence_opt_out(uuid,text)', 'execute'), '10: authenticated opt-out';
  assert not has_function_privilege('authenticated', 'public.same_day_absence_mark(uuid,text)', 'execute'), '10: authenticated mark';
  assert has_function_privilege('authenticated', 'public.same_day_absence_settings_save(boolean,time)', 'execute') and not has_function_privilege('anon', 'public.same_day_absence_settings_save(boolean,time)', 'execute'), '10: settings grants';
  assert not has_table_privilege('authenticated', 'public.same_day_absence_log', 'select'), '10: log closed';
  assert not has_table_privilege('authenticated', 'public.same_day_absence_settings', 'select'), '10: settings table closed';
  assert not has_table_privilege('authenticated', 'public.same_day_absence_optouts', 'select'), '10: opt-outs closed';

  raise notice 'same-day absence behavioural checks: all passed';
end
$$;

rollback;

do $$
begin
  if exists (select 1 from schools where slug = 'sda-test-a') or exists (select 1 from auth.users where email like 'sda-%@example.invalid') then
    raise exception 'LEAK DETECTED: same-day absence test fixtures were not rolled back';
  end if;
end
$$;
