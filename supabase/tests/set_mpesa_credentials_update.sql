-- Behavioral test for migration 20261101130000_fix_set_mpesa_credentials_update.
-- Rollback-only, synthetic fixtures (one throwaway school, one throwaway auth user); touches no real data.
--   psql "$SUPABASE_DB_URL" -v ON_ERROR_STOP=1 -f supabase/tests/set_mpesa_credentials_update.sql
-- Needs the migration already deployed. The caller is simulated with request.jwt.claims + role authenticated.
begin;

do $$
declare
  sa uuid := gen_random_uuid();
  u_owner uuid := gen_random_uuid();
  r_owner uuid;
  v_k1 uuid; v_s1 uuid; v_p1 uuid;
  v_k2 uuid; v_s2 uuid; v_p2 uuid;
  v_txt text; v_n int; v_failed boolean;
begin
  select id into r_owner from roles where name = 'school_owner';
  assert r_owner is not null, 'school_owner role exists';

  insert into auth.users (id, aud, role, email)
    values (u_owner, 'authenticated', 'authenticated', 'mpesacreds-owner@example.invalid');
  insert into schools (id, name, slug, application_number_prefix)
    values (sa, 'MPESA Creds Test', 'mpesa-creds-test', 'MCT');
  insert into school_users (auth_user_id, school_id, role_id, full_name, status)
    values (u_owner, sa, r_owner, 'Owner', 'active');

  execute 'set local role authenticated';
  perform set_config('request.jwt.claims',
    json_build_object('sub', u_owner, 'role', 'authenticated', 'aal', 'aal2')::text, true);

  -- 1. first save works and stores three secrets
  perform set_mpesa_credentials('600997', 'paybill', 'sandbox', 'key-one', 'secret-one', 'passkey-one');
  execute 'reset role';
  select consumer_key_id, consumer_secret_id, passkey_id into v_k1, v_s1, v_p1
    from mpesa_credentials where school_id = sa;
  assert v_k1 is not null and v_s1 is not null and v_p1 is not null, 'first save stored three secret ids';
  select decrypted_secret into v_txt from vault.decrypted_secrets where id = v_k1;
  assert v_txt = 'key-one', 'first save: key value stored';

  -- 2. THE BUG: a second save for the same school used to fail with secrets_name_idx
  execute 'set local role authenticated';
  perform set_config('request.jwt.claims',
    json_build_object('sub', u_owner, 'role', 'authenticated', 'aal', 'aal2')::text, true);
  perform set_mpesa_credentials('174379', 'paybill', 'sandbox', 'key-two', 'secret-two', 'passkey-two');
  execute 'reset role';

  select consumer_key_id, consumer_secret_id, passkey_id into v_k2, v_s2, v_p2
    from mpesa_credentials where school_id = sa;
  assert (v_k2, v_s2, v_p2) = (v_k1, v_s1, v_p1), 'second save updates in place: same secret ids';
  select decrypted_secret into v_txt from vault.decrypted_secrets where id = v_k2;
  assert v_txt = 'key-two', 'second save: key value replaced';
  select decrypted_secret into v_txt from vault.decrypted_secrets where id = v_s2;
  assert v_txt = 'secret-two', 'second save: secret value replaced';
  select decrypted_secret into v_txt from vault.decrypted_secrets where id = v_p2;
  assert v_txt = 'passkey-two', 'second save: passkey value replaced';
  select count(*) into v_n from vault.secrets where name like '%:' || sa::text;
  assert v_n = 3, 'exactly three secrets for the school after two saves (no duplicates, no leftovers)';
  select shortcode into v_txt from mpesa_settings where school_id = sa;
  assert v_txt = '174379', 'settings row updated by the second save';

  -- 3. a third save also works
  execute 'set local role authenticated';
  perform set_config('request.jwt.claims',
    json_build_object('sub', u_owner, 'role', 'authenticated', 'aal', 'aal2')::text, true);
  perform set_mpesa_credentials('600997', 'paybill', 'sandbox', 'key-three', 'secret-three', 'passkey-three');
  execute 'reset role';
  select decrypted_secret into v_txt from vault.decrypted_secrets where id = v_k1;
  assert v_txt = 'key-three', 'third save: key value replaced';

  -- 4. orphan case: credentials row removed by hand, secrets left behind -> first-save path must not collide
  delete from mpesa_credentials where school_id = sa;
  execute 'set local role authenticated';
  perform set_config('request.jwt.claims',
    json_build_object('sub', u_owner, 'role', 'authenticated', 'aal', 'aal2')::text, true);
  perform set_mpesa_credentials('600997', 'paybill', 'sandbox', 'key-four', 'secret-four', 'passkey-four');
  execute 'reset role';
  select count(*) into v_n from vault.secrets where name like '%:' || sa::text;
  assert v_n = 3, 'orphan case: still exactly three secrets';
  select decrypted_secret into v_txt from vault.decrypted_secrets
    where id = (select consumer_key_id from mpesa_credentials where school_id = sa);
  assert v_txt = 'key-four', 'orphan case: new value stored';

  -- 5. validation still enforced
  execute 'set local role authenticated';
  perform set_config('request.jwt.claims',
    json_build_object('sub', u_owner, 'role', 'authenticated', 'aal', 'aal2')::text, true);
  v_failed := false;
  begin perform set_mpesa_credentials('600997', 'paybill', 'sandbox', '', 'x', 'y');
  exception when others then v_failed := true; end;
  assert v_failed, 'empty field still refused';
  v_failed := false;
  begin perform set_mpesa_credentials('600997', 'paybill', 'staging', 'a', 'b', 'c');
  exception when others then v_failed := true; end;
  assert v_failed, 'bad environment still refused';
  execute 'reset role';

  raise notice 'set_mpesa_credentials_update: all assertions passed';
end $$;

rollback;
