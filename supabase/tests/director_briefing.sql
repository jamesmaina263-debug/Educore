-- Behavioural test for WP 3.1 (migration *_director_briefing_core). Rollback-only, synthetic fixtures (fake
-- 0700000xxx numbers), real role impersonation. One transaction ending in `rollback;`, then a leak tripwire.
-- Checks: both flags needed, consent layer reused (revoked number gets nothing), once per day, Mon-Fri morning vs
-- Saturday digest vs Sunday nothing, the 3-hour window, switches, figures, settings get/save + ranges, mark, grants.
--   psql "$SUPABASE_DB_URL" -v ON_ERROR_STOP=1 -f supabase/tests/director_briefing.sql
begin;

do $$
declare
  sa uuid := gen_random_uuid();
  u_o uuid := gen_random_uuid(); u_g uuid := gen_random_uuid(); su_o uuid := gen_random_uuid(); su_g uuid := gen_random_uuid();
  r_o uuid; r_p uuid; ay uuid := gen_random_uuid(); cl uuid := gen_random_uuid(); st uuid := gen_random_uuid();
  f_dir uuid; f_brief uuid; s_id uuid; i integer;
  -- fixed week: Mon 2 Mar 2026 .. Sun 8 Mar 2026
  mon timestamptz := timestamptz '2026-03-02 07:30+03';
  tue timestamptz := timestamptz '2026-03-03 07:30+03';
  sat timestamptz := timestamptz '2026-03-07 07:30+03';
  sun timestamptz := timestamptz '2026-03-08 07:30+03';
  v_n integer; v_json jsonb; v_failed boolean; v_log uuid; v_kind text; v_payload jsonb;
begin
  select id into r_o from roles where name = 'school_owner';
  select id into r_p from roles where name = 'parent';
  select id into f_dir from platform_feature_flags where key = 'feature.bot.director';
  select id into f_brief from platform_feature_flags where key = 'feature.bot.director_briefing';
  assert f_dir is not null and f_brief is not null, 'flag catalog entries exist';
  assert not exists (select 1 from school_feature_flags where flag_id = f_brief and enabled), 'briefing flag off everywhere';

  insert into schools (id, name, slug, application_number_prefix) values (sa, 'DBrief Test', 'dbrief-test-a', 'DBT');
  insert into auth.users (id, aud, role, email) values
    (u_o, 'authenticated', 'authenticated', 'db-o@example.invalid'), (u_g, 'authenticated', 'authenticated', 'db-g@example.invalid');
  insert into school_users (id, school_id, auth_user_id, role_id, full_name, status, phone) values
    (su_o, sa, u_o, r_o, 'DB Owner', 'active', '0700000333'), (su_g, sa, u_g, r_p, 'DB Parent', 'active', '0700000444');
  insert into academic_years (id, school_id, name, start_date, end_date) values (ay, sa, '2026', date '2026-01-01', date '2026-12-31');
  insert into classes (id, school_id, academic_year_id, name, level_order) values (cl, sa, ay, 'C1', 1);
  insert into streams (id, school_id, class_id, name) values (st, sa, cl, 'S1');
  -- 10 active learners. Monday 2 Mar is the previous school day for Tuesday: 8 present, 2 absent.
  -- Friday 27 Feb is the previous school day for Monday: 10 present.
  for i in 1..10 loop
    insert into students (school_id, first_name, last_name, date_of_birth, gender, status) values (sa, 'B' || i, 'T', date '2012-01-01', 'male', 'approved') returning id into s_id;
    insert into student_guardians (student_id, guardian_user_id, relationship, primary_contact) values (s_id, su_g, 'guardian', true);
    update students set status = 'enrolled' where id = s_id;
    update students set status = 'active' where id = s_id;
    insert into student_attendance (school_id, student_id, stream_id, attendance_date, status)
    values (sa, s_id, st, date '2026-03-02', case when i <= 8 then 'present' else 'absent' end),
           (sa, s_id, st, date '2026-02-27', 'present');
  end loop;
  insert into director_whatsapp_numbers (school_id, school_user_id, phone, consent_text) values (sa, su_o, '+254700000333', 'test opt-in');
  -- money: 5000 on Fri 27 Feb, 7000 on Sun 1 Mar, 3000 on Mon 2 Mar (all received); a pending one never counts
  insert into payments (school_id, method, amount, recorded_at, status) values
    (sa, 'cash', 5000, timestamptz '2026-02-27 10:00+03', 'unallocated'),
    (sa, 'mpesa', 7000, timestamptz '2026-03-01 10:00+03', 'unallocated'),
    (sa, 'mpesa', 3000, timestamptz '2026-03-02 10:00+03', 'unallocated'),
    (sa, 'mpesa', 99999, timestamptz '2026-03-02 11:00+03', 'pending'),
    (sa, 'cash', 2000, timestamptz '2026-02-25 10:00+03', 'unallocated');

  -- 1. flags: nothing without both
  select count(*) into v_n from director_briefing_evaluate(tue);
  assert v_n = 0, '1: both flags off -> nothing';
  insert into school_feature_flags (school_id, flag_id, enabled) values (sa, f_brief, true);
  select count(*) into v_n from director_briefing_evaluate(tue);
  assert v_n = 0, '1: only the briefing flag on (director flag off) -> nothing';
  insert into school_feature_flags (school_id, flag_id, enabled) values (sa, f_dir, true);

  -- 2. Tuesday morning briefing: logged once, figures for Monday 2 Mar
  select log_id, kind, payload into v_log, v_kind, v_payload from director_briefing_evaluate(tue);
  assert v_log is not null and v_kind = 'morning', '2: a morning briefing is produced';
  assert (v_payload ->> 'school_day')::date = date '2026-03-02', '2: previous school day is Monday';
  assert (v_payload ->> 'collected')::numeric = 3000, '2: money received on Monday only (pending ignored): ' || v_payload;
  assert ((v_payload -> 'attendance') ->> 'present')::int = 8 and ((v_payload -> 'attendance') ->> 'absent')::int = 2, '2: attendance of Monday';
  assert exists (select 1 from director_briefing_log where id = v_log and status = 'would_send' and kind = 'morning'), '2: logged as would_send';
  select count(*) into v_n from director_briefing_evaluate(tue);
  assert v_n = 0, '2: same day never twice';
  select count(*) into v_n from director_briefing_evaluate(tue + interval '1 hour');
  assert v_n = 0, '2: still once later in the window';

  -- 3. Monday morning looks back over the weekend to Friday
  select kind, payload into v_kind, v_payload from director_briefing_evaluate(mon);
  assert v_kind = 'morning' and (v_payload ->> 'school_day')::date = date '2026-02-27', '3: Monday -> Friday is the previous school day';
  assert (v_payload ->> 'collected')::numeric = 12000, '3: Friday + Sunday money (5000 + 7000): ' || v_payload;
  assert ((v_payload -> 'attendance') ->> 'present')::int = 10, '3: Friday attendance';

  -- 4. Saturday digest, Sunday nothing
  select kind, payload into v_kind, v_payload from director_briefing_evaluate(sat);
  assert v_kind = 'saturday', '4: Saturday produces the digest';
  -- Sat 7 Mar: this week = 1..7 Mar (7000 + 3000); the 7 days before = 22..28 Feb (5000 + 2000)
  assert (v_payload ->> 'collected')::numeric = 10000 and (v_payload ->> 'previous_week')::numeric = 7000, '4: 7 days vs the 7 before: ' || v_payload;
  assert (v_payload ->> 'attendance_rate_pct')::numeric = 80, '4: Mon-Fri 2..6 Mar holds only Monday\'s register: 8 present of 10';
  select count(*) into v_n from director_briefing_evaluate(sun);
  assert v_n = 0, '4: Sunday -> nothing';

  -- 5. window: before 07:00 and from 10:00 nothing (fresh days so the once-a-day rule is not what stops it)
  delete from director_briefing_log;
  select count(*) into v_n from director_briefing_evaluate(timestamptz '2026-03-03 06:59+03');
  assert v_n = 0, '5: before the briefing time -> nothing';
  select count(*) into v_n from director_briefing_evaluate(timestamptz '2026-03-03 10:00+03');
  assert v_n = 0, '5: a stale (3h later) run sends nothing';
  select count(*) into v_n from director_briefing_evaluate(timestamptz '2026-03-03 09:59+03');
  assert v_n = 1, '5: still inside the window';

  -- 6. switches
  delete from director_briefing_log;
  insert into director_briefing_settings (school_id, morning_enabled, saturday_enabled) values (sa, false, true);
  select count(*) into v_n from director_briefing_evaluate(tue);
  assert v_n = 0, '6: morning switched off';
  select count(*) into v_n from director_briefing_evaluate(sat);
  assert v_n = 1, '6: Saturday still on';
  delete from director_briefing_settings where school_id = sa;
  delete from director_briefing_log;

  -- 7. consent layer reused: a revoked number gets nothing; a guardian with the same number is never a director
  update director_whatsapp_numbers set status = 'revoked', revoked_at = now() where school_user_id = su_o;
  select count(*) into v_n from director_briefing_evaluate(tue);
  assert v_n = 0, '7: revoked registration -> nothing';
  update director_whatsapp_numbers set status = 'active', revoked_at = null where school_user_id = su_o;
  select count(*) into v_n from director_briefing_evaluate(tue);
  assert v_n = 1, '7: active again -> briefing';
  delete from director_briefing_log;

  -- 8. mark sent once
  select log_id into v_log from director_briefing_evaluate(tue);
  assert director_briefing_mark(v_log, 'sent'), '8: marked sent';
  assert not director_briefing_mark(v_log, 'failed'), '8: a sent row cannot be re-marked';
  v_failed := false; begin perform director_briefing_mark(v_log, 'bogus'); exception when others then v_failed := true; end;
  assert v_failed, '8: bad status refused';

  -- 9. settings via the real role
  execute 'set local role authenticated';
  perform set_config('request.jwt.claims', json_build_object('sub', u_o, 'role', 'authenticated')::text, true);
  v_json := director_briefing_settings_get();
  assert (v_json ->> 'eligible')::boolean and (v_json ->> 'briefing_time') = '07:00:00', '9: owner reads defaults';
  assert (director_briefing_settings_save(true, false, time '08:30') ->> 'status') = 'saved', '9: owner saves';
  assert (director_briefing_settings_get() ->> 'saturday_enabled')::boolean = false, '9: saved value read back';
  v_failed := false;
  begin perform director_briefing_settings_save(true, true, time '05:00'); exception when check_violation then v_failed := true; end;
  assert v_failed, '9: time outside 06:00 to 10:00 refused';
  perform set_config('request.jwt.claims', json_build_object('sub', u_g, 'role', 'authenticated')::text, true);
  v_failed := false;
  begin perform director_briefing_settings_save(true, true, time '07:00'); exception when sqlstate '42501' then v_failed := true; end;
  assert v_failed, '9: a parent cannot save';
  assert not (director_briefing_settings_get() ->> 'eligible')::boolean, '9: a parent is not eligible';
  perform set_config('request.jwt.claims', '{}', true);
  assert not (director_briefing_settings_get() ->> 'eligible')::boolean, '9: no caller is not eligible';
  execute 'reset role';

  -- 10. grants
  assert not has_function_privilege('anon', 'public.director_briefing_evaluate(timestamptz)', 'execute'), '10: anon evaluate';
  assert not has_function_privilege('authenticated', 'public.director_briefing_evaluate(timestamptz)', 'execute'), '10: authenticated evaluate';
  assert has_function_privilege('service_role', 'public.director_briefing_evaluate(timestamptz)', 'execute'), '10: service_role evaluate';
  assert not has_function_privilege('authenticated', 'public.director_briefing_mark(uuid,text)', 'execute'), '10: authenticated mark';
  assert not has_function_privilege('authenticated', 'public.director_briefing_payload(uuid,text,date)', 'execute'), '10: internal helper';
  assert not has_function_privilege('service_role', 'public.director_briefing_payload(uuid,text,date)', 'execute'), '10: internal helper (service)';
  assert not has_function_privilege('anon', 'public.director_briefing_settings_get()', 'execute'), '10: anon settings';
  assert not has_table_privilege('authenticated', 'public.director_briefing_log', 'select'), '10: log table closed';
  assert not has_table_privilege('authenticated', 'public.director_briefing_settings', 'select'), '10: settings table closed';

  raise notice 'director briefing behavioural checks: all passed';
end
$$;

rollback;

do $$
begin
  if exists (select 1 from schools where slug = 'dbrief-test-a')
     or exists (select 1 from auth.users where email like 'db-%@example.invalid') then
    raise exception 'LEAK DETECTED: director-briefing test fixtures were not rolled back -- fix this test file before trusting it again';
  end if;
end
$$;
