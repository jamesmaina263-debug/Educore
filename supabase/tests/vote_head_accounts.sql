-- Behavioural test for WP 6.3 (migration *_vote_head_account_names). Rollback-only, synthetic fixtures.
--   psql "$SUPABASE_DB_URL" -v ON_ERROR_STOP=1 -f supabase/tests/vote_head_accounts.sql
begin;

do $$
declare
  sa uuid := gen_random_uuid(); sb uuid := gen_random_uuid();
  u_bursar uuid := gen_random_uuid(); u_teacher uuid := gen_random_uuid(); u_bursar_b uuid := gen_random_uuid();
  r_burs uuid; r_teacher uuid; v_flag uuid; h uuid; v_failed boolean;
begin
  select id into r_burs from roles where name = 'bursar';
  select id into r_teacher from roles where name = 'teacher';
  assert r_burs is not null and r_teacher is not null, 'roles exist';
  insert into auth.users (id, aud, role, email) values
    (u_bursar, 'authenticated', 'authenticated', 'vhacct-bursar@example.invalid'),
    (u_teacher, 'authenticated', 'authenticated', 'vhacct-teacher@example.invalid'),
    (u_bursar_b, 'authenticated', 'authenticated', 'vhacct-bursar-b@example.invalid');
  insert into schools (id, name, slug, application_number_prefix) values (sa, 'VH Acct A', 'vhacct-a', 'VAA'), (sb, 'VH Acct B', 'vhacct-b', 'VAB');
  insert into school_users (auth_user_id, school_id, role_id, full_name, status) values
    (u_bursar, sa, r_burs, 'Bursar A', 'active'), (u_teacher, sa, r_teacher, 'Teacher A', 'active'), (u_bursar_b, sb, r_burs, 'Bursar B', 'active');
  select id into v_flag from platform_feature_flags where key = 'feature.finance.vote_heads';
  assert v_flag is not null, 'flag exists (WP 6.2)';
  insert into school_feature_flags (school_id, flag_id, enabled) values (sa, v_flag, true);
  insert into vote_heads (school_id, code, name, kind) values (sa, 'TUITION', 'Tuition', 'income') returning id into h;

  execute 'set local role authenticated';

  -- 1. bursar sets, replaces and clears the account name
  perform set_config('request.jwt.claims', json_build_object('sub', u_bursar, 'role', 'authenticated')::text, true);
  perform set_vote_head_account(h, '  4000 Tuition Income ');
  assert (select account_name from vote_heads where id = h) = '4000 Tuition Income', '1: trimmed and saved';
  perform set_vote_head_account(h, '4010 Fees');
  assert (select account_name from vote_heads where id = h) = '4010 Fees', '1: replaced';
  perform set_vote_head_account(h, '   ');
  assert (select account_name from vote_heads where id = h) is null, '1: blank clears it';

  -- 2. too long is refused
  v_failed := false;
  begin perform set_vote_head_account(h, repeat('x', 121)); exception when others then v_failed := true; end;
  assert v_failed, '2: over 120 characters refused';

  -- 3. a teacher (no finance.write) is refused
  perform set_config('request.jwt.claims', json_build_object('sub', u_teacher, 'role', 'authenticated')::text, true);
  v_failed := false;
  begin perform set_vote_head_account(h, 'Hijack'); exception when sqlstate '42501' then v_failed := true; end;
  assert v_failed, '3: teacher refused';

  -- 4. another school cannot touch it (flag on there too)
  execute 'reset role';
  insert into school_feature_flags (school_id, flag_id, enabled) values (sb, v_flag, true);
  execute 'set local role authenticated';
  perform set_config('request.jwt.claims', json_build_object('sub', u_bursar_b, 'role', 'authenticated')::text, true);
  v_failed := false;
  begin perform set_vote_head_account(h, 'Hijack'); exception when sqlstate '22023' then v_failed := true; end;
  assert v_failed, '4: other school cannot set it';

  -- 5. flag off => refused
  execute 'reset role';
  update school_feature_flags set enabled = false where school_id = sa and flag_id = v_flag;
  execute 'set local role authenticated';
  perform set_config('request.jwt.claims', json_build_object('sub', u_bursar, 'role', 'authenticated')::text, true);
  v_failed := false;
  begin perform set_vote_head_account(h, 'X'); exception when sqlstate '55000' then v_failed := true; end;
  assert v_failed, '5: flag off refused';

  -- 6. anon cannot execute
  execute 'reset role';
  assert not has_function_privilege('anon', 'public.set_vote_head_account(uuid,text)', 'execute'), '6: anon';
  assert has_function_privilege('authenticated', 'public.set_vote_head_account(uuid,text)', 'execute'), '6: authenticated';

  raise notice 'vote head account names behavioural checks: all passed';
end
$$;

rollback;

do $$
begin
  if exists (select 1 from schools where slug in ('vhacct-a', 'vhacct-b'))
     or exists (select 1 from auth.users where email like 'vhacct-%@example.invalid') then
    raise exception 'LEAK DETECTED: vote head account test fixtures were not rolled back -- fix this test file before trusting it again';
  end if;
end
$$;
