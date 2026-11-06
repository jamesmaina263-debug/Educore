-- Behavioural test for WP 4.1 (migration *_audit_hardening_privileged_paths). Rollback-only,
-- synthetic fixtures.
--   psql "$SUPABASE_DB_URL" -v ON_ERROR_STOP=1 -f supabase/tests/audit_hardening.sql
-- Callers are simulated with request.jwt.claims. Everything runs in one transaction ending in
-- `rollback;`; a final tripwire fails loudly if a fixture row persisted.
begin;

do $$
declare
  sa uuid := gen_random_uuid();
  u_owner uuid := gen_random_uuid();
  u_admin uuid := gen_random_uuid();
  r_owner uuid;
  su_owner uuid;
  v_flag uuid := gen_random_uuid();
  v_sf uuid;
  v_key uuid := gen_random_uuid();
  v_n integer; v_n2 integer; v_row audit_log%rowtype; v_failed boolean; v_state text;
  c_api constant text[] := array['anon', 'authenticated', 'authenticator', 'service_role'];
begin
  select id into r_owner from roles where name = 'school_owner';
  assert r_owner is not null, 'role exists';

  insert into auth.users (id, aud, role, email) values
    (u_owner, 'authenticated', 'authenticated', 'audhard-owner@example.invalid'),
    (u_admin, 'authenticated', 'authenticated', 'audhard-admin@example.invalid');
  insert into schools (id, name, slug, application_number_prefix) values (sa, 'Aud Hard A', 'aud-hard-a', 'AHA');
  insert into school_users (auth_user_id, school_id, role_id, full_name, status)
    values (u_owner, sa, r_owner, 'Owner A', 'active') returning id into su_owner;
  insert into platform_feature_flags (id, key, label) values (v_flag, 'feature.test.audit_hardening', 'Audit hardening test');

  -- 1. no signed-in user: audited as system
  perform set_config('request.jwt.claims', '', true);
  insert into school_feature_flags (school_id, flag_id, enabled) values (sa, v_flag, false) returning id into v_sf;
  select * into v_row from audit_log where table_name = 'school_feature_flags' and record_id = v_sf and action = 'create';
  assert v_row.id is not null, '1: create audited';
  assert v_row.actor_school_user_id is null and v_row.reason like 'system:%', '1: system attribution';
  assert (v_row.new_data ->> 'enabled') = 'false', '1: new data kept';

  -- 2. school owner flips the flag: actor attributed, old/new recorded
  perform set_config('request.jwt.claims', json_build_object('sub', u_owner, 'role', 'authenticated')::text, true);
  update school_feature_flags set enabled = true where id = v_sf;
  select * into v_row from audit_log where table_name = 'school_feature_flags' and record_id = v_sf and action = 'update';
  assert v_row.actor_school_user_id = su_owner and v_row.reason is null, '2: actor attributed';
  assert (v_row.old_data ->> 'enabled') = 'false' and (v_row.new_data ->> 'enabled') = 'true', '2: old/new';

  -- 3. no-op update logs nothing
  select count(*) into v_n from audit_log where table_name = 'school_feature_flags' and record_id = v_sf;
  update school_feature_flags set enabled = true where id = v_sf;
  select count(*) into v_n2 from audit_log where table_name = 'school_feature_flags' and record_id = v_sf;
  assert v_n = v_n2, '3: no-op update not logged';

  -- 4. signed-in person with no school_users row in this school (platform admin) is still named
  perform set_config('request.jwt.claims', json_build_object('sub', u_admin, 'role', 'authenticated')::text, true);
  update school_feature_flags set enabled = false where id = v_sf;
  select * into v_row from audit_log where table_name = 'school_feature_flags' and record_id = v_sf and action = 'update'
    order by created_at desc, id limit 1;
  assert exists (select 1 from audit_log where table_name = 'school_feature_flags' and record_id = v_sf
                   and reason = 'actor_auth_user=' || u_admin::text), '4: platform admin attributed by auth user id';

  -- 5. api_keys: hash never logged, last_used_at ignored, hash change flagged
  perform set_config('request.jwt.claims', json_build_object('sub', u_owner, 'role', 'authenticated')::text, true);
  insert into api_keys (id, school_id, name, key_prefix, key_hash, scopes, created_by)
    values (v_key, sa, 'Test key', 'audhard_pref', 'SECRETHASH_ONE', array['students.read'], su_owner);
  select * into v_row from audit_log where table_name = 'api_keys' and record_id = v_key and action = 'create';
  assert v_row.id is not null, '5: key create audited';
  assert (v_row.new_data ->> 'key_hash') = '[redacted]', '5: hash redacted';
  select count(*) into v_n from audit_log where table_name = 'api_keys' and record_id = v_key;
  update api_keys set last_used_at = now() where id = v_key;
  select count(*) into v_n2 from audit_log where table_name = 'api_keys' and record_id = v_key;
  assert v_n = v_n2, '5: last_used_at churn not logged';
  update api_keys set status = 'revoked', revoked_at = now(), revoked_by = su_owner where id = v_key;
  assert exists (select 1 from audit_log where table_name = 'api_keys' and record_id = v_key and action = 'update'
                   and new_data ->> 'status' = 'revoked' and actor_school_user_id = su_owner), '5: revoke audited with actor';
  update api_keys set key_hash = 'SECRETHASH_TWO' where id = v_key;
  assert exists (select 1 from audit_log where table_name = 'api_keys' and record_id = v_key
                   and new_data ->> 'key_hash' = '[redacted: changed]' and old_data ->> 'key_hash' = '[redacted]'), '5: hash change flagged';
  assert not exists (select 1 from audit_log where record_id = v_key and (new_data::text like '%SECRETHASH%' or old_data::text like '%SECRETHASH%')),
    '5: raw hash never stored';

  -- 6. audit_log is append-only
  perform set_config('request.jwt.claims', '', true);
  v_failed := false;
  begin update audit_log set reason = 'tamper' where record_id = v_sf; exception when insufficient_privilege then v_failed := true; end;
  assert v_failed, '6: update blocked';
  v_failed := false;
  begin delete from audit_log where record_id = v_sf; exception when insufficient_privilege then v_failed := true; end;
  assert v_failed, '6: delete blocked';
  v_failed := false;
  -- TRUNCATE takes ACCESS EXCLUSIVE on audit_log BEFORE its trigger or privilege check runs, so on
  -- a database with any other session holding a lock on audit_log (the nightly backup's pg_dump
  -- holds one for ~2 minutes) it queues, and every audited write queues behind it, until
  -- statement_timeout (120s). Fail fast instead: 3s, then a clear error. Observed 2026-11-05 09:13
  -- on production: 'canceling statement due to statement timeout' after exactly 120s.
  -- (Left at 3s for the rest of this transaction, which only runs quick statements.)
  perform set_config('lock_timeout', '3s', true);
  begin
    truncate audit_log;
  exception
    when insufficient_privilege then v_failed := true;
    when lock_not_available then
      raise exception '6: audit_log is locked by another session (a backup or a long transaction); not a logic failure, rerun when it has finished';
  end;
  assert v_failed, '6: truncate blocked';
  assert exists (select 1 from audit_log where record_id = v_sf), '6: rows intact';

  -- 7. controlled bypasses work for owner-level code only
  if current_user <> all (c_api) then
    perform set_config('educore.audit_log_maintenance', 'on', true);
    update audit_log set reason = 'scrubbed' where record_id = v_sf and action = 'create';
    perform set_config('educore.audit_log_maintenance', 'off', true);
    assert exists (select 1 from audit_log where record_id = v_sf and reason = 'scrubbed'), '7: maintenance bypass';
    perform set_config('educore.school_purge', 'on', true);
    delete from audit_log where record_id = v_sf and reason = 'scrubbed';
    perform set_config('educore.school_purge', 'off', true);
    assert not exists (select 1 from audit_log where record_id = v_sf and reason = 'scrubbed'), '7: purge bypass';
  end if;

  -- 8. API roles cannot use the bypass even with the switch set.
  --    authenticated: row-level security hides every audit_log row from an UPDATE, so it changes
  --    nothing (zero rows, no error). Either way the row must be unchanged.
  perform set_config('educore.audit_log_maintenance', 'on', true);
  set local role authenticated;
  begin
    update audit_log set reason = 'tamper' where record_id = v_sf;
  exception when others then
    null;
  end;
  reset role;
  assert not exists (select 1 from audit_log where reason = 'tamper'), '8: authenticated could not rewrite audit_log';
  --    service_role bypasses row-level security, so it reaches the trigger, which must refuse (42501).
  v_failed := false;
  set local role service_role;
  begin
    update audit_log set reason = 'tamper' where record_id = v_sf;
  exception when others then
    get stacked diagnostics v_state = returned_sqlstate;
    v_failed := (v_state = '42501');
  end;
  reset role;
  perform set_config('educore.audit_log_maintenance', 'off', true);
  assert v_failed, '8: service_role refused with 42501 even with the maintenance switch set';
  assert not exists (select 1 from audit_log where reason = 'tamper'), '8: service_role could not rewrite audit_log';

  -- 9. internal functions not callable by clients
  assert not has_function_privilege('anon', 'public.audit_privileged_change()', 'execute'), '9: anon';
  assert not has_function_privilege('authenticated', 'public.audit_privileged_change()', 'execute'), '9: authenticated';
  assert not has_function_privilege('authenticated', 'public.audit_log_block_change()', 'execute'), '9: block fn';

  raise notice 'audit hardening behavioural checks: all passed';
end
$$;

rollback;

do $$
begin
  if exists (select 1 from schools where slug = 'aud-hard-a')
     or exists (select 1 from auth.users where email like 'audhard-%@example.invalid') then
    raise exception 'LEAK DETECTED: audit hardening test fixtures were not rolled back -- fix this test file before trusting it again';
  end if;
end
$$;
