-- Behavioural test for WP 1.3 (migration *_wp_1_3_pay_by_link_core). Rollback-only, synthetic fixtures,
-- real role impersonation (request.jwt.claims). One transaction ending in `rollback;`; a final tripwire fails
-- loudly if any fixture row persisted. Checks: flag gate, finance.write gate, tenant isolation, token stored
-- only as a hash, neutral states (invalid/expired/revoked/used), one-prompt-at-a-time, phone validation,
-- failed prompt does not use the link up, completed payment does, grants (anon/authenticated cannot call the
-- public-side functions).
--   psql "$SUPABASE_DB_URL" -v ON_ERROR_STOP=1 -f supabase/tests/pay_by_link.sql
begin;

do $$
declare
  sa uuid := gen_random_uuid(); sb uuid := gen_random_uuid();
  u_bur uuid := gen_random_uuid(); u_tea uuid := gen_random_uuid(); u_burb uuid := gen_random_uuid();
  su_bur uuid := gen_random_uuid(); su_tea uuid := gen_random_uuid(); su_burb uuid := gen_random_uuid();
  ch1 uuid := gen_random_uuid(); chb uuid := gen_random_uuid();
  r_bur uuid; r_tea uuid; v_flag uuid;
  v_link uuid; v_tok text; v_hash text; v_exp timestamptz; v_n integer; v_failed boolean; v_msg text;
  v_status text; v_req uuid; v_req2 uuid; v_amt numeric; v_name text;
begin
  select id into r_bur from roles where name = 'bursar';
  select id into r_tea from roles where name = 'teacher';
  assert r_bur is not null and r_tea is not null, 'seed roles exist';

  insert into schools (id, name, slug, application_number_prefix) values
    (sa, 'PayLink Test A', 'paylink-test-a', 'PLA'), (sb, 'PayLink Test B', 'paylink-test-b', 'PLB');
  insert into auth.users (id, aud, role, email) values
    (u_bur, 'authenticated', 'authenticated', 'pl-bur@example.invalid'),
    (u_tea, 'authenticated', 'authenticated', 'pl-tea@example.invalid'),
    (u_burb, 'authenticated', 'authenticated', 'pl-burb@example.invalid');
  insert into school_users (id, school_id, auth_user_id, role_id, full_name, status) values
    (su_bur, sa, u_bur, r_bur, 'PL Bursar', 'active'),
    (su_tea, sa, u_tea, r_tea, 'PL Teacher', 'active'),
    (su_burb, sb, u_burb, r_bur, 'PL Bursar B', 'active');
  insert into students (id, school_id, first_name, last_name, date_of_birth, gender, status) values
    (ch1, sa, 'Amani', 'Tester', date '2012-01-01', 'male', 'approved'),
    (chb, sb, 'Baraka', 'Tester', date '2012-01-02', 'male', 'approved');
  insert into mpesa_settings (school_id, shortcode, shortcode_type, environment, is_active)
    values (sa, '174379', 'paybill', 'sandbox', true);

  select id into v_flag from platform_feature_flags where key = 'feature.finance.pay_by_link';
  assert v_flag is not null, 'flag catalog entry exists';
  -- Flags are now ON for real schools in production, so a global 'off for everyone' guard is no longer true and says nothing about this test's brand-new fixture schools.
  assert not exists (select 1 from school_feature_flags where flag_id = v_flag and school_id = sa and enabled), 'flag is off for the fixture school';

  -- 1. flag OFF: staff cannot create
  execute 'set local role authenticated';
  perform set_config('request.jwt.claims', json_build_object('sub', u_bur, 'role', 'authenticated')::text, true);
  v_failed := false;
  begin perform * from create_pay_link(ch1, 1500);
  exception when others then v_failed := true; end;
  assert v_failed, '1: flag off refuses create';
  execute 'reset role';

  insert into school_feature_flags (school_id, flag_id, enabled) values (sa, v_flag, true);

  -- 2. flag ON: bursar creates; token returned, only hash stored
  execute 'set local role authenticated';
  perform set_config('request.jwt.claims', json_build_object('sub', u_bur, 'role', 'authenticated')::text, true);
  select c.link_id, c.token, c.expires_at into v_link, v_tok, v_exp from create_pay_link(ch1, 1500) c;
  assert v_link is not null and length(v_tok) = 64, '2: link and 64-char token returned';
  assert v_exp > now() + interval '47 hours' and v_exp < now() + interval '49 hours', '2: default lifetime 48h';
  execute 'reset role';
  v_hash := encode(sha256(convert_to(v_tok, 'UTF8')), 'hex');
  assert exists (select 1 from pay_links where id = v_link and token_hash = v_hash and school_id = sa and amount = 1500), '2: hash stored';
  assert not exists (select 1 from pay_links where token_hash = v_tok), '2: raw token never stored';

  -- 3. a teacher (no finance.write) cannot create; other school's student refused; bad amount refused
  execute 'set local role authenticated';
  perform set_config('request.jwt.claims', json_build_object('sub', u_tea, 'role', 'authenticated')::text, true);
  v_failed := false;
  begin perform * from create_pay_link(ch1, 100); exception when others then v_failed := true; end;
  assert v_failed, '3: teacher cannot create';
  perform set_config('request.jwt.claims', json_build_object('sub', u_bur, 'role', 'authenticated')::text, true);
  v_failed := false;
  begin perform * from create_pay_link(chb, 100); exception when others then v_failed := true; end;
  assert v_failed, '3: cross-school student refused';
  v_failed := false;
  begin perform * from create_pay_link(ch1, 0); exception when others then v_failed := true; end;
  assert v_failed, '3: zero amount refused';
  v_failed := false;
  begin perform * from create_pay_link(ch1, 150001); exception when others then v_failed := true; end;
  assert v_failed, '3: over-cap amount refused';
  -- tenant isolation: bursar B sees no links of school A; bursar A can read but not the hash column
  perform set_config('request.jwt.claims', json_build_object('sub', u_burb, 'role', 'authenticated')::text, true);
  select count(*) into v_n from pay_links;
  assert v_n = 0, '3: other school sees no links';
  perform set_config('request.jwt.claims', json_build_object('sub', u_bur, 'role', 'authenticated')::text, true);
  select count(*) into v_n from pay_links;
  assert v_n = 1, '3: own school sees its link';
  v_failed := false;
  begin perform token_hash from pay_links; exception when insufficient_privilege then v_failed := true; end;
  assert v_failed, '3: token_hash column is not readable by staff';
  execute 'reset role';

  -- 4. public view: valid shows only school name, first name, amount
  select p.status, p.school_name, p.student_first_name, p.amount into v_status, v_name, v_msg, v_amt from pay_link_public_view(v_hash) p;
  assert v_status = 'valid' and v_name = 'PayLink Test A' and v_msg = 'Amani' and v_amt = 1500, '4: valid link view';
  select p.status into v_status from pay_link_public_view(repeat('a', 64)) p;
  assert v_status = 'invalid', '4: unknown token is invalid';

  -- 5. phone validation, then a real attempt
  v_failed := false;
  begin perform pay_link_begin_payment(v_hash, '0712345678', '1.2.3.4'); exception when others then v_failed := true; get stacked diagnostics v_msg = message_text; end;
  assert v_failed and v_msg = 'INVALID_PHONE', '5: non-254 format refused';
  v_req := pay_link_begin_payment(v_hash, '254712345678', '1.2.3.4');
  assert v_req is not null, '5: attempt raised';
  assert exists (select 1 from mpesa_stk_requests where id = v_req and school_id = sa and student_id = ch1 and amount = 1500 and status = 'pending' and initiated_by = su_bur and phone_number = '254712345678'), '5: STK request row correct';
  assert pay_link_attempt_status(v_hash, v_req) = 'pending', '5: attempt status readable with its own token';
  assert pay_link_attempt_status(repeat('b', 64), v_req) is null, '5: attempt status not readable with another token';

  -- 6. one prompt at a time
  v_failed := false;
  begin perform pay_link_begin_payment(v_hash, '254712345678', '1.2.3.4'); exception when others then v_failed := true; get stacked diagnostics v_msg = message_text; end;
  assert v_failed and v_msg = 'PROMPT_IN_PROGRESS', '6: second prompt while one is pending refused';

  -- 7. a failed prompt does not use the link up; a new attempt is allowed
  update mpesa_stk_requests set status = 'failed', result_desc = 'cancelled by user', resolved_at = now() where id = v_req;
  select p.status into v_status from pay_link_public_view(v_hash) p;
  assert v_status = 'valid', '7: still valid after a failed prompt';
  v_req2 := pay_link_begin_payment(v_hash, '254712345678', '1.2.3.4');
  assert v_req2 is not null and v_req2 <> v_req, '7: retry raises a new attempt';

  -- 8. a completed payment uses the link up
  update mpesa_stk_requests set status = 'completed', resolved_at = now() where id = v_req2;
  select p.status into v_status from pay_link_public_view(v_hash) p;
  assert v_status = 'used', '8: completed payment marks the link used';
  v_failed := false;
  begin perform pay_link_begin_payment(v_hash, '254712345678', '1.2.3.4'); exception when others then v_failed := true; get stacked diagnostics v_msg = message_text; end;
  assert v_failed and v_msg = 'LINK_NOT_AVAILABLE', '8: used link refuses new attempts';

  -- 9. expiry and revoke
  execute 'set local role authenticated';
  perform set_config('request.jwt.claims', json_build_object('sub', u_bur, 'role', 'authenticated')::text, true);
  select c.link_id, c.token into v_link, v_tok from create_pay_link(ch1, 700, null, 1) c;
  execute 'reset role';
  v_hash := encode(sha256(convert_to(v_tok, 'UTF8')), 'hex');
  update pay_links set expires_at = now() - interval '1 minute' where id = v_link;
  select p.status into v_status from pay_link_public_view(v_hash) p;
  assert v_status = 'expired', '9: expired link';
  update pay_links set expires_at = now() + interval '1 hour' where id = v_link;
  execute 'set local role authenticated';
  perform set_config('request.jwt.claims', json_build_object('sub', u_bur, 'role', 'authenticated')::text, true);
  perform revoke_pay_link(v_link);
  execute 'reset role';
  select p.status into v_status from pay_link_public_view(v_hash) p;
  assert v_status = 'revoked', '9: revoked link';

  -- 10. flag turned off at the school: public view says invalid even for a good link
  execute 'set local role authenticated';
  perform set_config('request.jwt.claims', json_build_object('sub', u_bur, 'role', 'authenticated')::text, true);
  select c.token into v_tok from create_pay_link(ch1, 300) c;
  execute 'reset role';
  v_hash := encode(sha256(convert_to(v_tok, 'UTF8')), 'hex');
  update school_feature_flags set enabled = false where school_id = sa and flag_id = v_flag;
  select p.status into v_status from pay_link_public_view(v_hash) p;
  assert v_status = 'invalid', '10: flag off makes every link invalid';

  -- 11. grants: public-side functions are service_role only; staff functions are not open to anon
  assert not has_function_privilege('anon', 'public.pay_link_public_view(text)', 'execute'), '11: anon view';
  assert not has_function_privilege('authenticated', 'public.pay_link_public_view(text)', 'execute'), '11: authenticated view';
  assert not has_function_privilege('anon', 'public.pay_link_begin_payment(text,text,text)', 'execute'), '11: anon begin';
  assert not has_function_privilege('authenticated', 'public.pay_link_begin_payment(text,text,text)', 'execute'), '11: authenticated begin';
  assert not has_function_privilege('authenticated', 'public.pay_link_attempt_status(text,uuid)', 'execute'), '11: authenticated status';
  assert has_function_privilege('service_role', 'public.pay_link_begin_payment(text,text,text)', 'execute'), '11: service_role begin';
  assert not has_function_privilege('anon', 'public.create_pay_link(uuid,numeric,uuid,integer)', 'execute'), '11: anon create';
  assert not has_function_privilege('anon', 'public.revoke_pay_link(uuid)', 'execute'), '11: anon revoke';
  assert not has_table_privilege('anon', 'public.pay_links', 'select'), '11: anon table';

  raise notice 'pay by link behavioural checks: all passed';
end
$$;

rollback;

do $$
begin
  if exists (select 1 from schools where slug in ('paylink-test-a', 'paylink-test-b'))
     or exists (select 1 from auth.users where email like 'pl-%@example.invalid') then
    raise exception 'LEAK DETECTED: pay-by-link test fixtures were not rolled back -- fix this test file before trusting it again';
  end if;
end
$$;
