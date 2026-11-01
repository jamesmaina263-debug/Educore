-- Behavioral test for Phase 1.1d (migration 20261101064758_c2b_mode_switch).
-- Rollback-only, synthetic fixtures (two throwaway schools, throwaway auth users); touches no real data.
--   psql "$SUPABASE_DB_URL" -v ON_ERROR_STOP=1 -f supabase/tests/c2b_mode_switch.sql
-- Needs the migration already deployed. Callers are simulated with request.jwt.claims + role authenticated.
begin;

do $$
declare
  sa uuid := gen_random_uuid();
  sb uuid := gen_random_uuid();
  u_owner_a uuid := gen_random_uuid();
  u_owner_b uuid := gen_random_uuid();
  u_burs_a uuid := gen_random_uuid();
  u_admin uuid := gen_random_uuid();
  v_flag_id uuid;
  r_owner uuid; r_burs uuid; r_admin uuid;
  v_txt text; v_n int; v_rec record; v_failed boolean; v_code text; v_audit_before int;

begin
  select id into v_flag_id from platform_feature_flags where lower(key) = 'feature.finance.c2b_capture';
  assert v_flag_id is not null, 'flag catalog row exists';
  select id into r_owner from roles where name = 'school_owner';
  select id into r_burs from roles where name = 'bursar';
  select id into r_admin from roles where name = 'super_admin';

  insert into auth.users (id, aud, role, email) values
    (u_owner_a, 'authenticated', 'authenticated', 'c2bmode-owner-a@example.invalid'),
    (u_owner_b, 'authenticated', 'authenticated', 'c2bmode-owner-b@example.invalid'),
    (u_burs_a,  'authenticated', 'authenticated', 'c2bmode-burs-a@example.invalid'),
    (u_admin,   'authenticated', 'authenticated', 'c2bmode-admin@example.invalid');
  insert into schools (id, name, slug, application_number_prefix) values
    (sa, 'C2B Mode A', 'c2b-mode-a', 'CMA'), (sb, 'C2B Mode B', 'c2b-mode-b', 'CMB');
  insert into school_users (auth_user_id, school_id, role_id, full_name, status) values
    (u_owner_a, sa, r_owner, 'Owner A', 'active'),
    (u_owner_b, sb, r_owner, 'Owner B', 'active'),
    (u_burs_a,  sa, r_burs,  'Bursar A', 'active'),
    (u_admin,   null, r_admin, 'Platform Admin', 'active');
  insert into mpesa_c2b_config (school_id) values (sa);   -- log_only, not registered, token auto-generated

  -- 1. anonymous / no caller
  execute 'set local role authenticated';
  perform set_config('request.jwt.claims', '{}', true);
  v_failed := false;
  begin perform c2b_set_mode(sa, 'log_only'); exception when others then v_failed := true; end;
  assert v_failed, 'no caller is refused';
  select count(*) into v_n from c2b_mode_status(sa);
  assert v_n = 0, 'no caller gets no status';

  -- helper: become a user
  perform set_config('request.jwt.claims', json_build_object('sub', u_owner_a, 'role', 'authenticated', 'aal', 'aal2')::text, true);

  -- 2. flag OFF: owner is refused, status is empty (fail closed)
  select count(*) into v_n from c2b_mode_status(sa);
  assert v_n = 0, 'flag off: status empty';
  v_failed := false;
  begin perform c2b_set_mode(sa, 'log_only'); exception when sqlstate '42501' then v_failed := true; end;
  assert v_failed, 'flag off: set refused';

  -- turn the flag on for school A only (as the table owner)
  execute 'reset role';
  insert into school_feature_flags (school_id, flag_id, enabled) values (sa, v_flag_id, true);
  execute 'set local role authenticated';
  perform set_config('request.jwt.claims', json_build_object('sub', u_owner_a, 'role', 'authenticated', 'aal', 'aal2')::text, true);

  -- 3. status for owner of A: config exists, log_only, not registered; token never exposed
  select * into v_rec from c2b_mode_status(sa);
  assert v_rec.cfg_exists and v_rec.cfg_mode = 'log_only' and not v_rec.cfg_registered, 'owner sees log_only/unregistered';
  select count(*) into v_n from information_schema.columns
   where table_name = 'c2b_mode_status' and column_name ilike '%token%';
  assert v_n = 0, 'status exposes no token column';

  -- 4. live refused while unregistered
  v_failed := false; v_code := null;
  begin perform c2b_set_mode(sa, 'live'); exception when others then v_failed := true; v_code := sqlstate; end;
  assert v_failed and v_code = '55000', 'live refused until registered, got ' || coalesce(v_code, 'none');

  -- 5. invalid mode
  v_failed := false;
  begin perform c2b_set_mode(sa, 'banana'); exception when sqlstate '22023' then v_failed := true; end;
  assert v_failed, 'invalid mode refused';

  -- 6. bursar (finance.read but not owner): can read status, cannot switch
  perform set_config('request.jwt.claims', json_build_object('sub', u_burs_a, 'role', 'authenticated', 'aal', 'aal2')::text, true);
  select count(*) into v_n from c2b_mode_status(sa);
  assert v_n = 1, 'finance reader can read status';
  v_failed := false;
  begin perform c2b_set_mode(sa, 'log_only'); exception when sqlstate '42501' then v_failed := true; end;
  assert v_failed, 'bursar cannot switch mode';

  -- 7. owner of ANOTHER school cannot touch school A (and sees nothing)
  perform set_config('request.jwt.claims', json_build_object('sub', u_owner_b, 'role', 'authenticated', 'aal', 'aal2')::text, true);
  select count(*) into v_n from c2b_mode_status(sa);
  assert v_n = 0, 'other school owner sees no status for A';
  v_failed := false;
  begin perform c2b_set_mode(sa, 'log_only'); exception when sqlstate '42501' then v_failed := true; end;
  assert v_failed, 'other school owner cannot switch A';

  -- 8. config row missing (school B has flag off AND no row): refused
  v_failed := false;
  begin perform c2b_set_mode(sb, 'log_only'); exception when sqlstate '42501' then v_failed := true; end;
  assert v_failed, 'flag-off school B refused';

  -- 9. mark registered (table owner), then owner switches to live, audit row written, token absent
  execute 'reset role';
  update mpesa_c2b_config set registered_at = now() where school_id = sa;
  select count(*) into v_audit_before from audit_log where school_id = sa and action = 'c2b_set_mode';
  execute 'set local role authenticated';
  perform set_config('request.jwt.claims', json_build_object('sub', u_owner_a, 'role', 'authenticated', 'aal', 'aal2')::text, true);
  v_txt := c2b_set_mode(sa, 'live');
  assert v_txt = 'live', 'owner switched to live';
  select * into v_rec from c2b_mode_status(sa);
  assert v_rec.cfg_mode = 'live' and v_rec.cfg_registered, 'status shows live/registered';

  execute 'reset role';
  select count(*) into v_n from audit_log where school_id = sa and action = 'c2b_set_mode';
  assert v_n = v_audit_before + 1, 'exactly one audit row written';
  select count(*) into v_n from audit_log
   where school_id = sa and action = 'c2b_set_mode'
     and (old_data::text || new_data::text) ilike '%' || (select confirmation_token from mpesa_c2b_config where school_id = sa) || '%';
  assert v_n = 0, 'audit row never contains the token';

  -- 10. repeat switch to live is a no-op (no extra audit row); back to log_only audited
  execute 'set local role authenticated';
  perform set_config('request.jwt.claims', json_build_object('sub', u_owner_a, 'role', 'authenticated', 'aal', 'aal2')::text, true);
  perform c2b_set_mode(sa, 'live');
  execute 'reset role';
  select count(*) into v_n from audit_log where school_id = sa and action = 'c2b_set_mode';
  assert v_n = v_audit_before + 1, 'no-op switch writes no audit row';
  execute 'set local role authenticated';
  perform set_config('request.jwt.claims', json_build_object('sub', u_owner_a, 'role', 'authenticated', 'aal', 'aal2')::text, true);
  assert c2b_set_mode(sa, 'log_only') = 'log_only', 'owner switched back to log_only';

  -- 11. platform admin can switch (and can read) any school with the flag on
  perform set_config('request.jwt.claims', json_build_object('sub', u_admin, 'role', 'authenticated', 'aal', 'aal2')::text, true);
  select count(*) into v_n from c2b_mode_status(sa);
  assert v_n = 1, 'platform admin can read status';
  assert c2b_set_mode(sa, 'live') = 'live', 'platform admin switched to live';

  -- 12. direct table access stays closed to signed-in users
  v_failed := false;
  begin perform 1 from mpesa_c2b_config; exception when insufficient_privilege then v_failed := true; end;
  assert v_failed, 'authenticated cannot read mpesa_c2b_config directly';

  -- 13. anon cannot execute either function
  execute 'reset role';
  assert not has_function_privilege('anon', 'public.c2b_set_mode(uuid,text)', 'execute'), 'anon cannot execute c2b_set_mode';
  assert not has_function_privilege('anon', 'public.c2b_mode_status(uuid)', 'execute'), 'anon cannot execute c2b_mode_status';
  assert has_function_privilege('authenticated', 'public.c2b_set_mode(uuid,text)', 'execute'), 'authenticated can execute c2b_set_mode';

  raise notice 'c2b_mode_switch: all assertions passed';
end $$;

rollback;
