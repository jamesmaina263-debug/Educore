-- Behavioral test for WP 8.3 (web push subscriptions). Rollback-only, synthetic fixtures, real role
-- impersonation (request.jwt.claims GUC), real deployed functions, policies and column grants.
-- Same safety model as staff_training_records.sql: opens with `begin;`, ends with `rollback;`, and a
-- tripwire in its own transaction fails loudly if any fixture persisted.
-- Run: psql "$SUPABASE_DB_URL" -v ON_ERROR_STOP=1 -f supabase/tests/web_push_subscriptions.sql
begin;

do $$
declare
  sa uuid := gen_random_uuid();
  sb uuid := gen_random_uuid();
  r_staff uuid;
  a_one uuid := gen_random_uuid();
  a_two uuid := gen_random_uuid();
  a_other uuid := gen_random_uuid();
  su_one uuid := gen_random_uuid();
  su_two uuid := gen_random_uuid();
  su_other uuid := gen_random_uuid();
  v_flag uuid;
  v_id uuid;
  v_id2 uuid;
  v_n int;
  v_failed boolean;
  v_state text;
  ep1 text := 'https://push.example.invalid/wpt-test-endpoint-one-0001';
  ep2 text := 'https://push.example.invalid/wpt-test-endpoint-two-0002';
  k1 text := 'BPtestkeytestkeytestkeytestkeytestkey1';
  au1 text := 'testauthsecret1';
begin
  select id into r_staff from roles where name = 'deputy_principal';
  assert r_staff is not null, 'fixture role deputy_principal exists';

  insert into schools (id, name, slug, application_number_prefix) values
    (sa, 'WPT Test School A', 'wpt-test-school-a', 'WPA'),
    (sb, 'WPT Test School B', 'wpt-test-school-b', 'WPB');
  insert into auth.users (id, aud, role, email) values
    (a_one, 'authenticated', 'authenticated', 'wpt-one@example.invalid'),
    (a_two, 'authenticated', 'authenticated', 'wpt-two@example.invalid'),
    (a_other, 'authenticated', 'authenticated', 'wpt-other@example.invalid');
  insert into school_users (id, school_id, auth_user_id, role_id, full_name, status) values
    (su_one, sa, a_one, r_staff, 'WPT One', 'active'),
    (su_two, sa, a_two, r_staff, 'WPT Two', 'active'),
    (su_other, sb, a_other, r_staff, 'WPT Other School', 'active');

  select id into v_flag from platform_feature_flags where lower(key) = 'feature.pwa.web_push';
  assert v_flag is not null, 'flag catalog entry exists';

  -- 1. flag off: registering is refused with 55000
  set local role authenticated;
  perform set_config('request.jwt.claims', json_build_object('sub', a_one, 'role', 'authenticated')::text, true);
  v_failed := false;
  begin
    perform register_push_subscription(ep1, k1, au1, 'ua');
  exception when others then
    get stacked diagnostics v_state = returned_sqlstate;
    v_failed := (v_state = '55000');
  end;
  reset role;
  assert v_failed, 'flag off: register refused with 55000';

  insert into school_feature_flags (school_id, flag_id, enabled) values (sa, v_flag, true);

  -- 2. person one registers a device; sees it, but cannot read the keys
  set local role authenticated;
  perform set_config('request.jwt.claims', json_build_object('sub', a_one, 'role', 'authenticated')::text, true);
  v_id := register_push_subscription(ep1, k1, au1, 'WPT browser');
  select count(*) into v_n from push_subscriptions where id = v_id;
  assert v_n = 1, 'person sees their own subscription';
  v_failed := false;
  begin
    perform p256dh from push_subscriptions where id = v_id;
  exception when others then
    get stacked diagnostics v_state = returned_sqlstate;
    v_failed := (v_state = '42501');
  end;
  assert v_failed, 'p256dh is not readable by the signed-in person (42501)';
  v_failed := false;
  begin
    perform auth from push_subscriptions where id = v_id;
  exception when others then
    get stacked diagnostics v_state = returned_sqlstate;
    v_failed := (v_state = '42501');
  end;
  assert v_failed, 'auth secret is not readable by the signed-in person (42501)';
  -- bad input refused
  v_failed := false;
  begin
    perform register_push_subscription('http://insecure.example.invalid/endpoint-0000001', k1, au1, null);
  exception when others then
    get stacked diagnostics v_state = returned_sqlstate;
    v_failed := (v_state = '22023');
  end;
  assert v_failed, 'non-https endpoint refused with 22023';
  -- no direct writes
  v_failed := false;
  begin
    insert into push_subscriptions (school_id, school_user_id, endpoint, p256dh, auth) values (sa, su_one, 'https://x.example.invalid/direct-insert-0001', k1, au1);
  exception when others then
    v_failed := true;
  end;
  reset role;
  assert v_failed, 'direct insert is refused';

  -- 3. person two cannot see person one's device
  set local role authenticated;
  perform set_config('request.jwt.claims', json_build_object('sub', a_two, 'role', 'authenticated')::text, true);
  select count(*) into v_n from push_subscriptions;
  assert v_n = 0, 'another person in the same school sees no devices of person one';
  reset role;

  -- 4. tenant isolation, even with the flag on for school B
  insert into school_feature_flags (school_id, flag_id, enabled) values (sb, v_flag, true);
  set local role authenticated;
  perform set_config('request.jwt.claims', json_build_object('sub', a_other, 'role', 'authenticated')::text, true);
  select count(*) into v_n from push_subscriptions;
  assert v_n = 0, 'other school sees no subscriptions';
  reset role;

  -- 5. the same browser used by person two: the row moves to them, same endpoint, not a second row
  set local role authenticated;
  perform set_config('request.jwt.claims', json_build_object('sub', a_two, 'role', 'authenticated')::text, true);
  v_id2 := register_push_subscription(ep1, k1, au1, 'WPT browser shared');
  reset role;
  assert v_id2 = v_id, 're-registering the same endpoint reuses the row';
  select count(*) into v_n from push_subscriptions where endpoint = ep1 and school_user_id = su_two;
  assert v_n = 1, 'the row moved to person two';
  select count(*) into v_n from push_subscriptions where endpoint = ep1;
  assert v_n = 1, 'still exactly one row for the endpoint';

  -- 6. sender function: targets for person two; none for person one; none for the wrong school; cap enforced
  select count(*) into v_n from push_targets_for_users(sa, array[su_two]);
  assert v_n = 1, 'sender finds the active subscription';
  select count(*) into v_n from push_targets_for_users(sa, array[su_one]);
  assert v_n = 0, 'sender finds nothing for a person with no device';
  select count(*) into v_n from push_targets_for_users(sb, array[su_two]);
  assert v_n = 0, 'sender does not return another school''s device';
  v_failed := false;
  begin
    perform * from push_targets_for_users(sa, (select array_agg(gen_random_uuid()) from generate_series(1, 501)));
  exception when others then
    get stacked diagnostics v_state = returned_sqlstate;
    v_failed := (v_state = '22023');
  end;
  assert v_failed, 'more than 500 recipients refused with 22023';

  -- 7. revoke: own device only; row kept; sender no longer sees it
  set local role authenticated;
  perform set_config('request.jwt.claims', json_build_object('sub', a_one, 'role', 'authenticated')::text, true);
  perform revoke_push_subscription(ep1);  -- person one no longer owns it: a no-op
  reset role;
  select count(*) into v_n from push_subscriptions where endpoint = ep1 and revoked_at is null;
  assert v_n = 1, 'someone else cannot revoke a device they do not own';
  set local role authenticated;
  perform set_config('request.jwt.claims', json_build_object('sub', a_two, 'role', 'authenticated')::text, true);
  perform revoke_push_subscription(ep1);
  reset role;
  select count(*) into v_n from push_subscriptions where endpoint = ep1 and revoked_at is not null;
  assert v_n = 1, 'owner revoked their device and the row is kept';
  select count(*) into v_n from push_targets_for_users(sa, array[su_two]);
  assert v_n = 0, 'revoked device is not a sender target';

  -- 8. a revoked device can be re-registered; a dead endpoint is marked by the sender
  set local role authenticated;
  perform set_config('request.jwt.claims', json_build_object('sub', a_two, 'role', 'authenticated')::text, true);
  perform register_push_subscription(ep2, k1, au1, null);
  reset role;
  select count(*) into v_n from push_targets_for_users(sa, array[su_two]);
  assert v_n = 1, 'a new device is a sender target';
  perform mark_push_subscription_dead(ep2);
  select count(*) into v_n from push_targets_for_users(sa, array[su_two]);
  assert v_n = 0, 'a dead endpoint stops being a target';

  -- 9. flag switched off: the sender sees no targets and registering is refused again
  set local role authenticated;
  perform set_config('request.jwt.claims', json_build_object('sub', a_two, 'role', 'authenticated')::text, true);
  perform register_push_subscription('https://push.example.invalid/wpt-test-endpoint-three-003', k1, au1, null);
  reset role;
  select count(*) into v_n from push_targets_for_users(sa, array[su_two]);
  assert v_n = 1, 'flag on: the new device is a sender target';
  update school_feature_flags set enabled = false where school_id = sa and flag_id = v_flag;
  select count(*) into v_n from push_targets_for_users(sa, array[su_two]);
  assert v_n = 0, 'flag off: the sender sees no targets';
  set local role authenticated;
  perform set_config('request.jwt.claims', json_build_object('sub', a_two, 'role', 'authenticated')::text, true);
  v_failed := false;
  begin
    perform register_push_subscription('https://push.example.invalid/wpt-test-endpoint-four-004', k1, au1, null);
  exception when others then
    get stacked diagnostics v_state = returned_sqlstate;
    v_failed := (v_state = '55000');
  end;
  reset role;
  assert v_failed, 'flag off: register refused again with 55000';

  -- 10. grants: browser roles cannot run the sender functions; anon cannot register or revoke
  assert not has_function_privilege('authenticated', 'public.push_targets_for_users(uuid,uuid[])', 'execute'), 'authenticated cannot run push_targets_for_users';
  assert not has_function_privilege('anon', 'public.push_targets_for_users(uuid,uuid[])', 'execute'), 'anon cannot run push_targets_for_users';
  assert not has_function_privilege('authenticated', 'public.mark_push_subscription_dead(text)', 'execute'), 'authenticated cannot run mark_push_subscription_dead';
  assert not has_function_privilege('anon', 'public.mark_push_subscription_dead(text)', 'execute'), 'anon cannot run mark_push_subscription_dead';
  assert has_function_privilege('service_role', 'public.push_targets_for_users(uuid,uuid[])', 'execute'), 'service_role can run push_targets_for_users';
  assert has_function_privilege('service_role', 'public.mark_push_subscription_dead(text)', 'execute'), 'service_role can run mark_push_subscription_dead';
  assert not has_function_privilege('anon', 'public.register_push_subscription(text,text,text,text)', 'execute'), 'anon cannot register';
  assert not has_function_privilege('anon', 'public.revoke_push_subscription(text)', 'execute'), 'anon cannot revoke';

  raise notice 'web_push_subscriptions behavioral checks: all passed';
end $$;

rollback;

-- Independent tripwire in its own transaction.
do $$
begin
  if exists (select 1 from schools where slug in ('wpt-test-school-a', 'wpt-test-school-b'))
     or exists (select 1 from auth.users where email like 'wpt-%@example.invalid')
     or exists (select 1 from push_subscriptions where endpoint like 'https://push.example.invalid/wpt-test-%') then
    raise exception 'LEAK DETECTED: web_push_subscriptions fixtures were not rolled back';
  end if;
end $$;
