-- Behavioral test for Phase 1.1d (migration *_c2b_mode_switch_and_status): set_c2b_mode() and
-- c2b_my_status(). Rollback-only, synthetic fixtures (three throwaway schools); touches no real
-- school's data. Same technique as c2b_ingest_payment.sql / school_users_tenant_move_rls.sql:
-- authenticated role + request.jwt.claims, one transaction that always ends in rollback.
--   psql "$SUPABASE_DB_URL" -v ON_ERROR_STOP=1 -f supabase/tests/c2b_mode_switch.sql
-- Not wired to a pull_request workflow because it needs the migration already deployed.
begin;

do $$
declare
  sa uuid := gen_random_uuid();   -- flag on, config row present
  sb uuid := gen_random_uuid();   -- flag on, NO config row
  sc uuid := gen_random_uuid();   -- flag off, config row present
  v_flag_id uuid;
  r_owner uuid; r_bursar uuid; r_teacher uuid; r_super uuid;
  a_owner_auth uuid := gen_random_uuid();
  a_bursar_auth uuid := gen_random_uuid();
  a_teacher_auth uuid := gen_random_uuid();
  b_owner_auth uuid := gen_random_uuid();
  c_owner_auth uuid := gen_random_uuid();
  super_auth uuid := gen_random_uuid();
  a_owner_su uuid := gen_random_uuid();
  v_token_a text;
  j jsonb;
  v_n int;
  v_txt text;
  v_audit_new jsonb;
begin
  select id into v_flag_id from platform_feature_flags where lower(key) = 'feature.finance.c2b_capture';
  assert v_flag_id is not null, 'flag catalog row exists';
  assert not exists (select 1 from school_feature_flags where flag_id = v_flag_id and enabled), 'flag is on for nobody before the test';

  select id into r_owner from roles where name = 'school_owner';
  select id into r_bursar from roles where name = 'bursar';
  select id into r_teacher from roles where name = 'teacher';
  select id into r_super from roles where name = 'super_admin';
  assert r_owner is not null and r_bursar is not null and r_teacher is not null and r_super is not null, 'roles exist';

  -- ---------- fixtures ----------
  insert into schools (id, name, slug, application_number_prefix) values
    (sa, 'C2B Mode A', 'c2b-mode-a', 'CMA'),
    (sb, 'C2B Mode B', 'c2b-mode-b', 'CMB'),
    (sc, 'C2B Mode C', 'c2b-mode-c', 'CMC');
  insert into auth.users (id, aud, role, email) values
    (a_owner_auth, 'authenticated', 'authenticated', 'c2b-mode-a-owner@example.invalid'),
    (a_bursar_auth, 'authenticated', 'authenticated', 'c2b-mode-a-bursar@example.invalid'),
    (a_teacher_auth, 'authenticated', 'authenticated', 'c2b-mode-a-teacher@example.invalid'),
    (b_owner_auth, 'authenticated', 'authenticated', 'c2b-mode-b-owner@example.invalid'),
    (c_owner_auth, 'authenticated', 'authenticated', 'c2b-mode-c-owner@example.invalid'),
    (super_auth, 'authenticated', 'authenticated', 'c2b-mode-super@example.invalid');
  insert into school_users (id, school_id, auth_user_id, role_id, full_name, status) values
    (a_owner_su, sa, a_owner_auth, r_owner, 'Mode A Owner', 'active'),
    (gen_random_uuid(), sa, a_bursar_auth, r_bursar, 'Mode A Bursar', 'active'),
    (gen_random_uuid(), sa, a_teacher_auth, r_teacher, 'Mode A Teacher', 'active'),
    (gen_random_uuid(), sb, b_owner_auth, r_owner, 'Mode B Owner', 'active'),
    (gen_random_uuid(), sc, c_owner_auth, r_owner, 'Mode C Owner', 'active'),
    (gen_random_uuid(), null, super_auth, r_super, 'Mode Super Admin', 'active');

  insert into mpesa_c2b_config (school_id) values (sa), (sc);
  select confirmation_token into v_token_a from mpesa_c2b_config where school_id = sa;

  -- ---------- 0. grants: nothing reachable for anon, config table still sealed ----------
  assert not has_function_privilege('anon', 'public.set_c2b_mode(uuid,text)', 'execute'), 'anon cannot execute set_c2b_mode';
  assert not has_function_privilege('anon', 'public.c2b_my_status()', 'execute'), 'anon cannot execute c2b_my_status';
  assert has_function_privilege('authenticated', 'public.set_c2b_mode(uuid,text)', 'execute'), 'authenticated can execute set_c2b_mode';
  assert has_function_privilege('authenticated', 'public.c2b_my_status()', 'execute'), 'authenticated can execute c2b_my_status';
  assert not has_table_privilege('authenticated', 'public.mpesa_c2b_config', 'select'), 'authenticated has no select on the config table';
  assert not has_table_privilege('authenticated', 'public.mpesa_c2b_config', 'update'), 'authenticated has no update on the config table';

  -- ---------- 1. unauthenticated ----------
  begin perform set_c2b_mode(sa, 'live'); assert false, 'no-auth call accepted';
  exception when others then assert sqlerrm = 'Not authenticated.', 'no auth: ' || sqlerrm; end;
  assert (c2b_my_status()) = jsonb_build_object('enabled', false), 'status without a session is disabled';

  -- ---------- 2. flag off: everything refuses / hides ----------
  set local role authenticated;
  perform set_config('request.jwt.claims', json_build_object('sub', a_owner_auth, 'role', 'authenticated')::text, true);
  begin perform set_c2b_mode(sa, 'live'); assert false, 'flag-off switch accepted';
  exception when others then assert sqlerrm = 'This feature is not enabled for the school.', 'flag off: ' || sqlerrm; end;
  assert c2b_my_status() = jsonb_build_object('enabled', false), 'status hidden while flag off';
  reset role;

  -- Turn the flag on for A and B only (C stays off).
  insert into school_feature_flags (school_id, flag_id, enabled) values (sa, v_flag_id, true), (sb, v_flag_id, true);

  -- ---------- 3. permission and tenant isolation ----------
  set local role authenticated;
  perform set_config('request.jwt.claims', json_build_object('sub', a_bursar_auth, 'role', 'authenticated')::text, true);
  begin perform set_c2b_mode(sa, 'live'); assert false, 'bursar (finance.write) switched mode';
  exception when others then assert sqlerrm = 'Not permitted.', 'bursar: ' || sqlerrm; end;
  reset role;

  set local role authenticated;
  perform set_config('request.jwt.claims', json_build_object('sub', a_teacher_auth, 'role', 'authenticated')::text, true);
  begin perform set_c2b_mode(sa, 'live'); assert false, 'teacher switched mode';
  exception when others then assert sqlerrm = 'Not permitted.', 'teacher: ' || sqlerrm; end;
  reset role;

  -- Owner of B (flag on) must not touch school A, and owner of A must not touch B or C.
  set local role authenticated;
  perform set_config('request.jwt.claims', json_build_object('sub', b_owner_auth, 'role', 'authenticated')::text, true);
  begin perform set_c2b_mode(sa, 'log_only'); assert false, 'owner of B acted on A';
  exception when others then assert sqlerrm = 'Not permitted.', 'cross-tenant B->A: ' || sqlerrm; end;
  reset role;

  set local role authenticated;
  perform set_config('request.jwt.claims', json_build_object('sub', a_owner_auth, 'role', 'authenticated')::text, true);
  begin perform set_c2b_mode(sb, 'log_only'); assert false, 'owner of A acted on B';
  exception when others then assert sqlerrm = 'Not permitted.', 'cross-tenant A->B: ' || sqlerrm; end;
  begin perform set_c2b_mode(sc, 'log_only'); assert false, 'owner of A acted on C';
  exception when others then assert sqlerrm = 'Not permitted.', 'cross-tenant A->C: ' || sqlerrm; end;
  reset role;

  -- ---------- 4. validation, missing config, flag-off school ----------
  set local role authenticated;
  perform set_config('request.jwt.claims', json_build_object('sub', a_owner_auth, 'role', 'authenticated')::text, true);
  begin perform set_c2b_mode(sa, 'bogus'); assert false, 'bad mode accepted';
  exception when others then assert sqlerrm = 'Invalid mode.', 'bad mode: ' || sqlerrm; end;
  begin perform set_c2b_mode(sa, null); assert false, 'null mode accepted';
  exception when others then assert sqlerrm = 'Invalid mode.', 'null mode: ' || sqlerrm; end;
  begin perform set_c2b_mode(null, 'live'); assert false, 'null school accepted';
  exception when others then assert sqlerrm = 'School is required.', 'null school: ' || sqlerrm; end;
  reset role;

  set local role authenticated;
  perform set_config('request.jwt.claims', json_build_object('sub', b_owner_auth, 'role', 'authenticated')::text, true);
  begin perform set_c2b_mode(sb, 'live'); assert false, 'switch without a config row accepted';
  exception when others then assert sqlerrm = 'C2B is not set up for this school.', 'no config row: ' || sqlerrm; end;
  j := c2b_my_status();
  assert (j->>'enabled')::boolean and not (j->>'configured')::boolean, 'B status: enabled but not configured';
  reset role;

  set local role authenticated;
  perform set_config('request.jwt.claims', json_build_object('sub', c_owner_auth, 'role', 'authenticated')::text, true);
  begin perform set_c2b_mode(sc, 'live'); assert false, 'flag-off school switched';
  exception when others then assert sqlerrm = 'This feature is not enabled for the school.', 'C flag off: ' || sqlerrm; end;
  assert c2b_my_status() = jsonb_build_object('enabled', false), 'C status hidden (flag off)';
  reset role;

  -- ---------- 5. live guard: refused until registered_at is set ----------
  set local role authenticated;
  perform set_config('request.jwt.claims', json_build_object('sub', a_owner_auth, 'role', 'authenticated')::text, true);
  begin perform set_c2b_mode(sa, 'live'); assert false, 'live accepted without registration';
  exception when others then assert sqlerrm = 'Register the C2B URL before switching to live.', 'live guard: ' || sqlerrm; end;
  j := c2b_my_status();
  assert (j->>'mode') = 'log_only' and not (j->>'registered')::boolean, 'A status before registration';
  reset role;
  assert (select mode from mpesa_c2b_config where school_id = sa) = 'log_only', 'mode unchanged after refused switch';
  select count(*) into v_n from audit_log where school_id = sa and action = 'c2b_mode_change';
  assert v_n = 0, 'a refused switch writes no audit row';

  -- ---------- 6. happy path ----------
  update mpesa_c2b_config set registered_at = now() where school_id = sa;

  set local role authenticated;
  perform set_config('request.jwt.claims', json_build_object('sub', a_owner_auth, 'role', 'authenticated')::text, true);
  j := c2b_my_status();
  assert (j->>'enabled')::boolean and (j->>'configured')::boolean and (j->>'registered')::boolean
     and (j->>'can_switch')::boolean and (j->>'mode') = 'log_only', 'owner status after registration';
  assert not (j ? 'confirmation_token'), 'status never exposes the token';

  j := set_c2b_mode(sa, 'live');
  assert (j->>'changed')::boolean and (j->>'mode') = 'live', 'switch to live';
  assert not (j ? 'confirmation_token'), 'switch result never exposes the token';

  j := set_c2b_mode(sa, 'live');
  assert not (j->>'changed')::boolean, 'repeat switch is a no-op';
  reset role;

  select count(*) into v_n from audit_log where school_id = sa and action = 'c2b_mode_change';
  assert v_n = 1, 'exactly one audit row for the one real change, got ' || v_n;
  select new_data into v_audit_new from audit_log where school_id = sa and action = 'c2b_mode_change';
  assert (v_audit_new->>'mode') = 'live' and (v_audit_new->>'actor_kind') = 'school_owner', 'audit new_data content';
  assert (select actor_school_user_id from audit_log where school_id = sa and action = 'c2b_mode_change') = a_owner_su, 'audit actor is the owner school_user';
  select count(*) into v_n from audit_log where school_id = sa and (old_data::text like '%' || v_token_a || '%' or new_data::text like '%' || v_token_a || '%');
  assert v_n = 0, 'the confirmation token never appears in audit_log';
  assert (select confirmation_token from mpesa_c2b_config where school_id = sa) = v_token_a, 'token untouched by mode changes';

  -- Bursar can SEE the status (finance.read) but cannot switch.
  set local role authenticated;
  perform set_config('request.jwt.claims', json_build_object('sub', a_bursar_auth, 'role', 'authenticated')::text, true);
  j := c2b_my_status();
  assert (j->>'enabled')::boolean and (j->>'mode') = 'live' and not (j->>'can_switch')::boolean, 'bursar sees status, cannot switch';
  reset role;

  -- A teacher has no finance.read: status stays hidden.
  set local role authenticated;
  perform set_config('request.jwt.claims', json_build_object('sub', a_teacher_auth, 'role', 'authenticated')::text, true);
  assert c2b_my_status() = jsonb_build_object('enabled', false), 'teacher status hidden';
  reset role;

  -- Back to log_only is allowed and audited.
  set local role authenticated;
  perform set_config('request.jwt.claims', json_build_object('sub', a_owner_auth, 'role', 'authenticated')::text, true);
  j := set_c2b_mode(sa, 'log_only');
  assert (j->>'changed')::boolean and (j->>'mode') = 'log_only', 'switch back to log_only';
  reset role;
  select count(*) into v_n from audit_log where school_id = sa and action = 'c2b_mode_change';
  assert v_n = 2, 'two audit rows after two real changes, got ' || v_n;

  -- ---------- 7. platform super admin (MFA-enforced helper; aal2 claim supplied) ----------
  set local role authenticated;
  perform set_config('request.jwt.claims', json_build_object('sub', super_auth, 'role', 'authenticated', 'aal', 'aal2')::text, true);
  j := set_c2b_mode(sa, 'live');
  assert (j->>'changed')::boolean and (j->>'mode') = 'live', 'super admin can switch';
  reset role;
  select new_data into v_audit_new from audit_log where school_id = sa and action = 'c2b_mode_change' order by created_at desc, id limit 1;
  assert (select count(*) from audit_log where school_id = sa and action = 'c2b_mode_change') = 3, 'third audit row';
  assert (select count(*) from audit_log where school_id = sa and action = 'c2b_mode_change' and new_data->>'actor_kind' = 'platform_admin' and actor_school_user_id is null) = 1, 'super admin audit row marked platform_admin';

  -- ---------- 8. nothing leaked to other schools ----------
  assert (select mode from mpesa_c2b_config where school_id = sc) = 'log_only', 'school C untouched';
  assert not exists (select 1 from mpesa_c2b_config where school_id = sb), 'school B still has no config row';
  assert not exists (select 1 from audit_log where school_id in (sb, sc) and action = 'c2b_mode_change'), 'no audit rows for B or C';

  raise notice 'c2b mode switch behavioral checks: all passed';
end $$;

rollback;

do $$
begin
  if exists (select 1 from schools where slug in ('c2b-mode-a', 'c2b-mode-b', 'c2b-mode-c')) then
    raise exception 'LEAK DETECTED: c2b-mode fixture rows were not rolled back';
  end if;
end $$;
