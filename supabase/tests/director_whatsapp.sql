-- Behavioural test for WP 3.3 (migration *_director_whatsapp_core). Rollback-only, synthetic fixtures.
--   psql "$SUPABASE_DB_URL" -v ON_ERROR_STOP=1 -f supabase/tests/director_whatsapp.sql
-- Callers are simulated with request.jwt.claims + role authenticated. Never asserts any real school's flag state.
begin;

do $$
declare
  sa uuid := gen_random_uuid(); sb uuid := gen_random_uuid();
  ua uuid := gen_random_uuid(); ub uuid := gen_random_uuid(); ut uuid := gen_random_uuid();
  ay uuid := gen_random_uuid(); tm uuid := gen_random_uuid();
  s1 uuid := gen_random_uuid(); s2 uuid := gen_random_uuid();
  r_prin uuid; r_owner uuid; r_teacher uuid; r_parent uuid; r_burs uuid; flag uuid;
  r jsonb; n integer; failed boolean; g1 uuid;
begin
  select id into r_prin from roles where name = 'principal';
  select id into r_owner from roles where name = 'school_owner';
  select id into r_teacher from roles where name = 'teacher';
  select id into r_parent from roles where name = 'parent';
  select id into r_burs from roles where name = 'bursar';
  select id into flag from platform_feature_flags where key = 'feature.bot.director';
  assert flag is not null, '1: flag in the catalog';

  insert into auth.users (id, aud, role, email) values
    (ua, 'authenticated', 'authenticated', 'dirwa-a@example.invalid'),
    (ub, 'authenticated', 'authenticated', 'dirwa-b@example.invalid'),
    (ut, 'authenticated', 'authenticated', 'dirwa-t@example.invalid');
  insert into schools (id, name, slug, application_number_prefix) values (sa, 'Dir WA A', 'dir-wa-a', 'DWA'), (sb, 'Dir WA B', 'dir-wa-b', 'DWB');
  insert into school_users (auth_user_id, school_id, role_id, full_name, phone, status) values
    (ua, sa, r_prin, 'Pat Principal', '0711000999', 'active'),
    (ub, sb, r_owner, 'Olu Owner', '0722000111', 'active'),
    (ut, sa, r_teacher, 'Tess Teacher', '0733000222', 'active');

  -- 2. flag off => disabled
  execute 'set local role authenticated';
  perform set_config('request.jwt.claims', json_build_object('sub', ua, 'role', 'authenticated')::text, true);
  r := director_whatsapp_register('0711000999', true);
  assert r->>'status' = 'disabled', '2: flag off -> disabled: ' || r::text;
  execute 'reset role';
  insert into school_feature_flags (school_id, flag_id, enabled) values (sa, flag, true), (sb, flag, true);

  -- 3. teacher refused, no caller refused
  execute 'set local role authenticated';
  perform set_config('request.jwt.claims', json_build_object('sub', ut, 'role', 'authenticated')::text, true);
  failed := false; begin perform director_whatsapp_register('0733000222', true); exception when sqlstate '42501' then failed := true; end;
  assert failed, '3: a teacher cannot register';
  perform set_config('request.jwt.claims', '{}', true);
  failed := false; begin perform director_whatsapp_register('0711000999', true); exception when sqlstate '42501' then failed := true; end;
  assert failed, '3: no caller refused';

  -- 4. input rules
  perform set_config('request.jwt.claims', json_build_object('sub', ua, 'role', 'authenticated')::text, true);
  assert (director_whatsapp_register('0711000999', false))->>'status' = 'consent_required', '4: consent required';
  assert (director_whatsapp_register('12345', true))->>'status' = 'invalid_phone', '4: invalid phone';
  assert (director_whatsapp_register('0799999999', true))->>'status' = 'phone_mismatch', '4: must be own profile number';

  -- 5. guardian with the same number at the school blocks registration
  execute 'reset role';
  insert into school_users (school_id, role_id, full_name, phone, status) values (sa, r_parent, 'Mum Fx', '+254711000999', 'active');
  execute 'set local role authenticated';
  assert (director_whatsapp_register('0711000999', true))->>'status' = 'phone_is_guardian', '5: guardian number refused';
  execute 'reset role';
  delete from school_users where full_name = 'Mum Fx';

  -- 6. success + status + masked
  execute 'set local role authenticated';
  r := director_whatsapp_register('+254 711 000 999', true);
  assert r->>'status' = 'registered' and r->>'phone_masked' = '+254******999', '6: registered: ' || r::text;
  assert ((director_whatsapp_status())->>'registered')::boolean, '6: status registered';
  -- (7 removed: school_users has a unique index on active phones, uq_school_users_active_phone, so two active staff can
  -- never hold the same number; the phone_in_use branch is only a second line of defence.)

  execute 'reset role';
  perform set_config('request.jwt.claims', '{}', true);   -- service side: no staff caller (the school_users trigger guards role_id/status for staff)
  -- 8. lookup + answers (service side)
  select count(*) into n from director_whatsapp_lookup('+254711000999'); assert n = 1, '8: lookup finds the director';
  select count(*) into n from director_whatsapp_lookup('+254700000000'); assert n = 0, '8: unknown number';

  insert into academic_years (id, school_id, name, start_date, end_date) values (ay, sa, 'AY', current_date - 100, current_date + 200);
  insert into terms (id, school_id, academic_year_id, name, term_number, start_date, end_date) values (tm, sa, ay, 'T1', 1, current_date - 90, current_date + 90);
  insert into students (id, school_id, first_name, last_name, date_of_birth, gender, status) values
    (s1, sa, 'Sam', 'One', date '2012-01-01', 'male', 'approved'), (s2, sa, 'Sue', 'Two', date '2012-01-02', 'female', 'approved');
  insert into school_users (school_id, role_id, full_name, phone, status) values (sa, r_parent, 'Guardian Fx', '+254700099001', 'active') returning id into g1;
  insert into student_guardians (student_id, guardian_user_id, relationship, primary_contact) values (s1, g1, 'guardian', true), (s2, g1, 'guardian', true);
  update students set status = 'enrolled' where id in (s1, s2);
  update students set status = 'active' where id in (s1, s2);
  insert into invoices (school_id, student_id, term_id, total_amount) values (sa, s1, tm, 5000), (sa, s2, tm, 1500);
  insert into payments (school_id, student_id, method, amount, status) values (sa, s1, 'mpesa', 300, 'unallocated');

  r := director_whatsapp_answer('+254711000999', 'collection_today', 'SMdw1');
  assert r->>'status' = 'ok' and (r->'data'->>'total')::numeric = 300 and (r->'data'->>'count')::integer = 1, '8: collection today: ' || r::text;
  r := director_whatsapp_answer('+254711000999', 'outstanding', 'SMdw2');
  assert (r->'data'->>'outstanding')::numeric = 6500 and (r->'data'->>'learners_owing')::integer = 2 and (r->'data'->>'unallocated_received')::numeric = 300, '8: outstanding: ' || r::text;
  r := director_whatsapp_answer('+254711000999', 'top_arrears', 'SMdw3');
  assert r->'data'->'rows'->0->>'name' = 'Sam O.', '8: top arrears: ' || r::text;
  r := director_whatsapp_answer('+254711000999', 'attendance_today', 'SMdw4');
  assert (r->'data'->>'active_learners')::integer = 2 and (r->'data'->>'marked')::integer = 0, '8: attendance with nothing marked: ' || r::text;
  r := director_whatsapp_answer('+254711000999', 'absentees_today', 'SMdw5');
  assert (r->'data'->>'total')::integer = 0, '8: absentees none: ' || r::text;
  r := director_whatsapp_answer('+254711000999', 'enrolment', 'SMdw6');
  assert (r->'data'->>'active_learners')::integer = 2, '8: enrolment: ' || r::text;
  assert (director_whatsapp_answer('+254711000999', 'enrolment', 'SMdw6'))->>'status' = 'duplicate', '8: a repeated MessageSid is a no-op';
  assert (director_whatsapp_answer('+254711000999', 'drop table', 'SMdw7'))->>'status' = 'unknown_topic', '8: unknown topic';
  assert (director_whatsapp_answer('+254799999999', 'enrolment', 'SMdw8'))->>'status' = 'not_director', '8: not a director';
  select count(*) into n from director_whatsapp_log where school_id = sa; assert n = 7, '8: 7 log rows, got ' || n;

  -- 9. eligibility ends when anything changes
  update school_users set phone = '0700111222' where auth_user_id = ua;
  select count(*) into n from director_whatsapp_lookup('+254711000999'); assert n = 0, '9: profile phone changed';
  update school_users set phone = '0711000999' where auth_user_id = ua;
  update school_users set role_id = r_burs where auth_user_id = ua;
  select count(*) into n from director_whatsapp_lookup('+254711000999'); assert n = 0, '9: role no longer allowed';
  update school_users set role_id = r_prin where auth_user_id = ua;
  update school_feature_flags set enabled = false where school_id = sa and flag_id = flag;
  select count(*) into n from director_whatsapp_lookup('+254711000999'); assert n = 0, '9: flag off';
  update school_feature_flags set enabled = true where school_id = sa and flag_id = flag;
  update school_users set status = 'suspended' where auth_user_id = ua;
  select count(*) into n from director_whatsapp_lookup('+254711000999'); assert n = 0, '9: suspended';
  update school_users set status = 'active' where auth_user_id = ua;
  insert into school_users (school_id, role_id, full_name, phone, status) values (sa, r_parent, 'Mum Fx', '+254711000999', 'active');
  select count(*) into n from director_whatsapp_lookup('+254711000999'); assert n = 0, '9: also a guardian here';
  delete from school_users where full_name = 'Mum Fx';

  -- 10. revoke
  execute 'set local role authenticated';
  perform set_config('request.jwt.claims', json_build_object('sub', ua, 'role', 'authenticated')::text, true);
  assert (director_whatsapp_revoke())->>'status' = 'revoked', '10: revoked';
  execute 'reset role';
  select count(*) into n from director_whatsapp_lookup('+254711000999'); assert n = 0, '10: revoked number is not answered';

  -- 11. grants and direct table access
  assert not has_function_privilege('anon', 'public.director_whatsapp_answer(text,text,text)', 'execute'), '11: anon answer';
  assert not has_function_privilege('authenticated', 'public.director_whatsapp_answer(text,text,text)', 'execute'), '11: authenticated answer';
  assert not has_function_privilege('authenticated', 'public.director_whatsapp_lookup(text)', 'execute'), '11: authenticated lookup';
  assert not has_function_privilege('anon', 'public.director_whatsapp_register(text,boolean)', 'execute'), '11: anon register';
  assert has_function_privilege('authenticated', 'public.director_whatsapp_register(text,boolean)', 'execute'), '11: authenticated register';
  assert not has_table_privilege('authenticated', 'public.director_whatsapp_numbers', 'select'), '11: numbers table closed';
  assert not has_table_privilege('authenticated', 'public.director_whatsapp_log', 'select'), '11: log table closed';

  raise notice 'director whatsapp behavioural checks: all passed';
end
$$;

rollback;

do $$
begin
  if exists (select 1 from schools where slug in ('dir-wa-a', 'dir-wa-b')) or exists (select 1 from auth.users where email like 'dirwa-%@example.invalid') then
    raise exception 'LEAK DETECTED: director whatsapp test fixtures were not rolled back';
  end if;
end
$$;
