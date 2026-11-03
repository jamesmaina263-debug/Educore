-- Behavioural test for migration *_rollback_unfinished_signup (R-new-17 follow-up). Rollback-only, synthetic fixtures.
--   psql "$SUPABASE_DB_URL" -v ON_ERROR_STOP=1 -f supabase/tests/signup_rollback.sql
-- Runs the REAL deployed function the way the signup action does (service_role), after the same client-side steps as
-- rollbackSignup in src/app/signup/actions.ts. Complements audit_hardening.sql (append-only + bypass switches): this file
-- is the only test that deletes a school. Fixture schools only; never asserts anything about real schools. One
-- transaction ending in `rollback;` plus a leak tripwire in its own transaction.
begin;

do $$
declare
  r_owner uuid;
  s_ok uuid := gen_random_uuid(); s_users uuid := gen_random_uuid(); s_stud uuid := gen_random_uuid();
  s_old uuid := gen_random_uuid(); s_active uuid := gen_random_uuid(); s_other uuid := gen_random_uuid();
  u_ok uuid := gen_random_uuid(); u_users uuid := gen_random_uuid(); u_other uuid := gen_random_uuid();
  res jsonb; n_other_before bigint; n bigint; v_failed boolean; v_audit_id uuid;
begin
  select id into r_owner from roles where name = 'school_owner';
  assert r_owner is not null, 'school_owner role exists';

  insert into auth.users (id, aud, role, email) values
    (u_ok, 'authenticated', 'authenticated', 'signuprb-ok@example.invalid'),
    (u_users, 'authenticated', 'authenticated', 'signuprb-users@example.invalid'),
    (u_other, 'authenticated', 'authenticated', 'signuprb-other@example.invalid');
  insert into schools (id, name, slug, application_number_prefix, status) values
    (s_ok, 'SignupRb ok', 'signuprb-ok', 'SR1', 'trial'), (s_users, 'SignupRb users', 'signuprb-users', 'SR2', 'trial'),
    (s_stud, 'SignupRb students', 'signuprb-stud', 'SR3', 'trial'), (s_old, 'SignupRb old', 'signuprb-old', 'SR4', 'trial'),
    (s_active, 'SignupRb active', 'signuprb-active', 'SR5', 'active'), (s_other, 'SignupRb other', 'signuprb-other', 'SR6', 'trial');
  -- owners (these inserts fire the audit and biometric triggers, exactly like a real signup)
  insert into school_users (auth_user_id, school_id, role_id, full_name, status) values
    (u_ok, s_ok, r_owner, 'SR Owner', 'active'), (u_users, s_users, r_owner, 'SR Owner U', 'active'), (u_other, s_other, r_owner, 'SR Owner O', 'active');
  insert into school_subscriptions (school_id) values (s_ok);
  insert into students (school_id, first_name, last_name, date_of_birth, gender, status) values (s_stud, 'Sr', 'Student', date '2012-01-01', 'male', 'approved');
  update schools set created_at = now() - interval '2 hours' where id = s_old;

  select count(*) into n from audit_log where school_id = s_ok;
  assert n >= 1, '0: the owner insert wrote an audit row, so a plain school delete cannot work (sanity)';
  select count(*) into n_other_before from audit_log where school_id = s_other;
  assert n_other_before >= 1, '0: other school has audit rows';

  -- 1. the guards refuse everything that is not a brand-new trial school with no users and no students
  execute 'set local role service_role';
  assert (rollback_unfinished_signup(null))->>'reason' = 'no_school_id', '1: null refused';
  assert (rollback_unfinished_signup(gen_random_uuid()))->>'reason' = 'not_found', '1: unknown school refused';
  assert (rollback_unfinished_signup(s_users))->>'reason' = 'has_users', '1: school that still has a user refused';
  assert (rollback_unfinished_signup(s_stud))->>'reason' = 'has_students', '1: school with a student refused';
  assert (rollback_unfinished_signup(s_old))->>'reason' = 'not_a_new_trial_school', '1: old school refused';
  assert (rollback_unfinished_signup(s_active))->>'reason' = 'not_a_new_trial_school', '1: non-trial school refused';
  execute 'reset role';
  select count(*) into n from schools where id in (s_users, s_stud, s_old, s_active);
  assert n = 4, '1: nothing was deleted by a refusal';
  assert exists (select 1 from audit_log where school_id = s_users), '1: refused school''s audit rows intact';

  -- 2. the real flow: client steps as service_role, the plain school delete is refused, the function finishes the job
  execute 'set local role service_role';
  delete from school_users where auth_user_id = u_ok;
  delete from school_subscriptions where school_id = s_ok;
  delete from inventory_items where school_id = s_ok;
  delete from inventory_categories where school_id = s_ok;
  res := rollback_unfinished_signup(s_ok);
  assert (res->>'deleted')::boolean is true, '2: fresh failed signup is removed: ' || res::text;
  execute 'reset role';
  assert not exists (select 1 from schools where id = s_ok), '2: school gone';
  assert not exists (select 1 from audit_log where school_id = s_ok), '2: its audit rows gone';
  assert not exists (select 1 from biometric_profiles where school_id = s_ok), '2: its biometric profile rows gone';
  assert not exists (select 1 from leave_types where school_id = s_ok), '2: seeded leave types gone';

  -- 3. only that school was touched
  select count(*) into n from audit_log where school_id = s_other;
  assert n = n_other_before, '3: another school''s audit rows untouched';
  assert exists (select 1 from schools where id = s_other), '3: another school untouched';

  -- 4. audit_log is still append-only afterwards: the bypass was not left on
  select id into v_audit_id from audit_log where school_id = s_other limit 1;
  v_failed := false;
  begin
    delete from audit_log where id = v_audit_id;
  exception when sqlstate '42501' then v_failed := true;
  end;
  assert v_failed, '4: audit_log delete is refused again after the function ran (bypass not left on)';
  assert coalesce(current_setting('educore.school_purge', true), '') <> 'on', '4: purge switch is off';

  -- 5. privileges: only service_role
  assert not has_function_privilege('anon', 'public.rollback_unfinished_signup(uuid)', 'execute'), '5: anon may not run it';
  assert not has_function_privilege('authenticated', 'public.rollback_unfinished_signup(uuid)', 'execute'), '5: signed-in users may not run it';
  assert has_function_privilege('service_role', 'public.rollback_unfinished_signup(uuid)', 'execute'), '5: service_role may run it';

  raise notice 'signup rollback behavioural checks: all passed';
end
$$;

rollback;

do $$
begin
  if exists (select 1 from schools where slug like 'signuprb-%')
     or exists (select 1 from auth.users where email like 'signuprb-%@example.invalid') then
    raise exception 'LEAK DETECTED: signup-rollback test fixtures were not rolled back -- fix this test file before trusting it again';
  end if;
end
$$;
