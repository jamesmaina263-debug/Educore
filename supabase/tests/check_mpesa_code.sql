-- Behavioral test for Phase 1.2 (migration *_check_mpesa_code). Rollback-only, synthetic fixtures.
--   psql "$SUPABASE_DB_URL" -v ON_ERROR_STOP=1 -f supabase/tests/check_mpesa_code.sql
-- Needs the migration already deployed. Callers are simulated with request.jwt.claims + role authenticated.
begin;

do $$
declare
  sa uuid := gen_random_uuid();
  sb uuid := gen_random_uuid();
  u_burs_a uuid := gen_random_uuid();
  u_burs_b uuid := gen_random_uuid();
  u_teacher_a uuid := gen_random_uuid();
  r_burs uuid; r_teacher uuid;
  v_res jsonb; v_failed boolean; v_batch uuid := gen_random_uuid();
begin
  select id into r_burs from roles where name = 'bursar';
  select id into r_teacher from roles where name = 'teacher';
  assert r_burs is not null and r_teacher is not null, 'roles exist';

  insert into auth.users (id, aud, role, email) values
    (u_burs_a, 'authenticated', 'authenticated', 'chkcode-burs-a@example.invalid'),
    (u_burs_b, 'authenticated', 'authenticated', 'chkcode-burs-b@example.invalid'),
    (u_teacher_a, 'authenticated', 'authenticated', 'chkcode-teacher-a@example.invalid');
  insert into schools (id, name, slug, application_number_prefix) values
    (sa, 'Chk Code A', 'chk-code-a', 'CCA'), (sb, 'Chk Code B', 'chk-code-b', 'CCB');
  insert into school_users (auth_user_id, school_id, role_id, full_name, status) values
    (u_burs_a, sa, r_burs, 'Bursar A', 'active'),
    (u_burs_b, sb, r_burs, 'Bursar B', 'active'),
    (u_teacher_a, sa, r_teacher, 'Teacher A', 'active');

  -- school A: an unallocated M-Pesa payment (reference lower-case with spaces) and a statement line
  insert into payments (school_id, method, amount, reference, status, source, purpose)
    values (sa, 'mpesa', 500, ' ab12 cd34ef ', 'unallocated', 'manual', 'test');
  insert into mpesa_statement_batches (id, school_id, source_label) values (v_batch, sa, 'test.csv');
  insert into mpesa_statement_lines (batch_id, school_id, receipt_no, amount, match_status)
    values (v_batch, sa, 'ZZ99YY88XX', 700, 'not_in_system');

  -- 1. no caller refused
  execute 'set local role authenticated';
  perform set_config('request.jwt.claims', '{}', true);
  v_failed := false;
  begin perform check_mpesa_code('AB12CD34EF'); exception when sqlstate '42501' then v_failed := true; end;
  assert v_failed, 'no caller refused';

  -- 2. non-finance role refused
  perform set_config('request.jwt.claims', json_build_object('sub', u_teacher_a, 'role', 'authenticated', 'aal', 'aal2')::text, true);
  v_failed := false;
  begin perform check_mpesa_code('AB12CD34EF'); exception when sqlstate '42501' then v_failed := true; end;
  assert v_failed, 'caller without finance.read refused';

  -- 3. bursar of A: recorded, case/space-insensitive
  perform set_config('request.jwt.claims', json_build_object('sub', u_burs_a, 'role', 'authenticated', 'aal', 'aal2')::text, true);
  v_res := check_mpesa_code('ab12cd34ef');
  assert v_res->>'verdict' = 'recorded', 'recorded verdict';
  assert jsonb_array_length(v_res->'payments') = 1, 'one payment';
  assert (v_res->>'c2b_checked')::boolean = false, 'c2b not checked when flag off';

  -- 4. statement-only code: seen_not_recorded
  v_res := check_mpesa_code('ZZ99YY88XX');
  assert v_res->>'verdict' = 'seen_not_recorded', 'statement-only verdict';
  assert jsonb_array_length(v_res->'statement_lines') = 1, 'one statement line';

  -- 5. unknown code
  v_res := check_mpesa_code('QQ11WW22EE');
  assert v_res->>'verdict' = 'not_found', 'not found';

  -- 6. malformed input
  v_failed := false;
  begin perform check_mpesa_code('abc'); exception when sqlstate '22023' then v_failed := true; end;
  assert v_failed, 'too short refused';
  v_failed := false;
  begin perform check_mpesa_code('AB12-CD34-EF'); exception when sqlstate '22023' then v_failed := true; end;
  assert v_failed, 'punctuation refused';

  -- 7. tenant isolation: bursar of B cannot see A's code
  perform set_config('request.jwt.claims', json_build_object('sub', u_burs_b, 'role', 'authenticated', 'aal', 'aal2')::text, true);
  v_res := check_mpesa_code('AB12CD34EF');
  assert v_res->>'verdict' = 'not_found', 'other school sees nothing';
  v_res := check_mpesa_code('ZZ99YY88XX');
  assert v_res->>'verdict' = 'not_found', 'other school sees no statement line';

  -- 8. anon cannot execute
  execute 'set local role anon';
  v_failed := false;
  begin perform check_mpesa_code('AB12CD34EF'); exception when insufficient_privilege then v_failed := true; end;
  assert v_failed, 'anon cannot execute';

  execute 'reset role';
  raise notice 'check_mpesa_code tests passed';
end
$$;

rollback;
