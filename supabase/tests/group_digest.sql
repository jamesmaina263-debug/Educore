-- Behavioural test for WP 3.4 (migration *_wp_3_4_group_digest_core). Rollback-only, synthetic fixtures, real role impersonation.
-- One transaction ending in `rollback;`, then a leak tripwire.
-- Checks: only a group admin registers, own-number rule, consent names every school, a school appears only with its flags on and
-- not opted out (school-level consent beats group membership), Saturday 07:00-10:00 only, once per Saturday, revoke, grants.
-- Nothing is ever sent.
--   psql "$SUPABASE_DB_URL" -v ON_ERROR_STOP=1 -f supabase/tests/group_digest.sql
begin;

do $$
declare
  grp uuid := gen_random_uuid();
  sa uuid := gen_random_uuid(); sb uuid := gen_random_uuid(); sc uuid := gen_random_uuid();
  u_ga uuid := gen_random_uuid(); u_p uuid := gen_random_uuid();
  su_ga uuid := gen_random_uuid(); su_p uuid := gen_random_uuid();
  r_ga uuid; r_p uuid; f_gd uuid; f_brief uuid;
  sat timestamptz := timestamptz '2026-03-07 07:30+03';
  sat2 timestamptz := timestamptz '2026-03-14 07:30+03';
  mon timestamptz := timestamptz '2026-03-09 07:30+03';
  v_n integer; v_json jsonb; v_failed boolean; v_payload jsonb; v_log uuid; v_text text;
begin
  select id into r_ga from roles where name = 'group_admin';
  select id into r_p from roles where name = 'principal';
  select id into f_gd from platform_feature_flags where key = 'feature.bot.group_digest';
  select id into f_brief from platform_feature_flags where key = 'feature.bot.director_briefing';
  assert f_gd is not null and f_brief is not null, '0: flags in the catalog';

  insert into school_groups (id, name) values (grp, 'GD Test Group');
  insert into schools (id, name, slug, application_number_prefix, school_group_id) values
    (sa, 'GD School A', 'gd-test-a', 'GDA', grp), (sb, 'GD School B', 'gd-test-b', 'GDB', grp), (sc, 'GD School C', 'gd-test-c', 'GDC', grp);
  insert into auth.users (id, aud, role, email) values
    (u_ga, 'authenticated', 'authenticated', 'gd-ga@example.invalid'), (u_p, 'authenticated', 'authenticated', 'gd-p@example.invalid');
  insert into school_users (id, school_group_id, auth_user_id, role_id, full_name, status, phone) values
    (su_ga, grp, u_ga, r_ga, 'GD Group Admin', 'active', '0700000666');
  insert into school_users (id, school_id, auth_user_id, role_id, full_name, status, phone) values
    (su_p, sa, u_p, r_p, 'GD Principal A', 'active', '0700000777');

  -- 1. no school of the group has the flag -> disabled
  execute 'set local role authenticated';
  perform set_config('request.jwt.claims', json_build_object('sub', u_ga, 'role', 'authenticated')::text, true);
  assert (group_digest_register('0700000666', true))->>'status' = 'disabled', '1: flag off -> disabled';
  execute 'reset role';
  insert into school_feature_flags (school_id, flag_id, enabled) values (sa, f_gd, true), (sb, f_gd, true), (sc, f_gd, true);

  -- 2. who may register, and the rules
  execute 'set local role authenticated';
  perform set_config('request.jwt.claims', json_build_object('sub', u_p, 'role', 'authenticated')::text, true);
  v_failed := false; begin perform group_digest_register('0700000777', true); exception when sqlstate '42501' then v_failed := true; end;
  assert v_failed, '2: a school principal is not a group admin';
  perform set_config('request.jwt.claims', '{}', true);
  v_failed := false; begin perform group_digest_register('0700000666', true); exception when sqlstate '42501' then v_failed := true; end;
  assert v_failed, '2: no caller refused';
  perform set_config('request.jwt.claims', json_build_object('sub', u_ga, 'role', 'authenticated')::text, true);
  assert (group_digest_register('0700000666', false))->>'status' = 'consent_required', '2: consent required';
  assert (group_digest_register('12345', true))->>'status' = 'invalid_phone', '2: invalid phone';
  assert (group_digest_register('0799999999', true))->>'status' = 'phone_mismatch', '2: must be own profile number';
  assert (group_digest_status())->>'registered' = 'false', '2: not registered yet';
  v_json := group_digest_register('+254 700 000 666', true);
  assert v_json->>'status' = 'registered' and v_json->>'phone_masked' = '+254******666', '2: registered: ' || v_json::text;
  assert (group_digest_status())->>'registered' = 'true', '2: status registered';
  execute 'reset role';
  select consent_text into v_text from group_digest_numbers where school_user_id = su_ga and status = 'active';
  assert v_text like '%GD School A%' and v_text like '%GD School B%' and v_text like '%GD School C%', '2: consent names every school';

  -- 3. Saturday, but no school has director_briefing on -> nothing
  select count(*) into v_n from group_digest_evaluate(sat); assert v_n = 0, '3: no school qualifies';

  -- 4. briefing on for A and C (B has none); C opted out directly -> only A in the digest
  insert into school_feature_flags (school_id, flag_id, enabled) values (sa, f_brief, true), (sc, f_brief, true);
  insert into group_digest_school_optouts (school_id) values (sc);

  -- 4a. school-level opt-out by A's principal removes A too -> no school left -> nothing; opting back in restores it
  execute 'set local role authenticated';
  perform set_config('request.jwt.claims', json_build_object('sub', u_p, 'role', 'authenticated')::text, true);
  assert (group_digest_school_optout_set(true))->>'status' = 'saved', '4a: opt out';
  perform set_config('request.jwt.claims', json_build_object('sub', u_ga, 'role', 'authenticated')::text, true);
  v_failed := false; begin perform group_digest_school_optout_set(true); exception when sqlstate '42501' then v_failed := true; end;
  assert v_failed, '4a: a group admin cannot opt a school out';
  execute 'reset role';
  select count(*) into v_n from group_digest_evaluate(sat); assert v_n = 0, '4a: opted-out schools are excluded';
  execute 'set local role authenticated';
  perform set_config('request.jwt.claims', json_build_object('sub', u_p, 'role', 'authenticated')::text, true);
  perform group_digest_school_optout_set(false);
  execute 'reset role';
  perform set_config('request.jwt.claims', '{}', true);

  -- 5. timing
  select count(*) into v_n from group_digest_evaluate(mon); assert v_n = 0, '5: Monday';
  select count(*) into v_n from group_digest_evaluate(timestamptz '2026-03-07 10:30+03'); assert v_n = 0, '5: after the window';
  select count(*) into v_n from group_digest_evaluate(timestamptz '2026-03-07 06:30+03'); assert v_n = 0, '5: before the window';

  -- 6. Saturday inside the window: one digest, one block (A only)
  select count(*), min(e.log_id::text)::uuid, (array_agg(e.payload))[1] into v_n, v_log, v_payload from group_digest_evaluate(sat) e;
  assert v_n = 1, '6: one digest: ' || v_n::text;
  assert v_payload->>'kind' = 'group_saturday' and jsonb_array_length(v_payload->'schools') = 1
     and v_payload->'schools'->0->>'school' = 'GD School A' and v_payload->'schools'->0->'figures'->>'kind' = 'saturday', '6: one block for school A with the Saturday figures: ' || v_payload::text;
  select count(*) into v_n from group_digest_evaluate(sat + interval '20 minutes'); assert v_n = 0, '6: once per Saturday';
  assert group_digest_mark(v_log, 'sent') = true and group_digest_mark(v_log, 'sent') = false, '6: mark moves would_send once';

  -- 7. revoke: nothing next Saturday
  execute 'set local role authenticated';
  perform set_config('request.jwt.claims', json_build_object('sub', u_ga, 'role', 'authenticated')::text, true);
  assert (group_digest_revoke())->>'status' = 'revoked', '7: revoked';
  assert (group_digest_revoke())->>'status' = 'not_registered', '7: revoke twice is harmless';
  execute 'reset role';
  select count(*) into v_n from group_digest_evaluate(sat2); assert v_n = 0, '7: revoked number gets nothing';

  -- 8. grants and direct table access
  assert not has_function_privilege('anon', 'public.group_digest_evaluate(timestamptz)', 'execute'), '8: anon evaluate';
  assert not has_function_privilege('authenticated', 'public.group_digest_evaluate(timestamptz)', 'execute'), '8: authenticated evaluate';
  assert has_function_privilege('service_role', 'public.group_digest_evaluate(timestamptz)', 'execute'), '8: service_role evaluate';
  assert not has_function_privilege('authenticated', 'public.group_digest_mark(uuid,text)', 'execute'), '8: authenticated mark';
  assert has_function_privilege('authenticated', 'public.group_digest_register(text,boolean)', 'execute') and not has_function_privilege('anon', 'public.group_digest_register(text,boolean)', 'execute'), '8: register grants';
  assert not has_table_privilege('authenticated', 'public.group_digest_numbers', 'select'), '8: numbers table closed';
  assert not has_table_privilege('authenticated', 'public.group_digest_log', 'select'), '8: log closed';

  raise notice 'group digest behavioural checks: all passed';
end
$$;

rollback;

do $$
begin
  if exists (select 1 from schools where slug in ('gd-test-a', 'gd-test-b', 'gd-test-c'))
     or exists (select 1 from school_groups where name = 'GD Test Group')
     or exists (select 1 from auth.users where email like 'gd-%@example.invalid') then
    raise exception 'LEAK DETECTED: group digest test fixtures were not rolled back';
  end if;
end
$$;
