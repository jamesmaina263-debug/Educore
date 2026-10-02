-- Behavioral test: a staff.manage holder (principal) must NOT be able to move their own
-- school_users row, or another staff member's, into a different school. Same technique
-- and safety model as scheme_of_work_rls.sql: synthetic fixtures, authenticated role +
-- request.jwt.claims, everything inside one transaction that ends in rollback.
--   psql "$SUPABASE_DB_URL" -v ON_ERROR_STOP=1 -f supabase/tests/school_users_tenant_move_rls.sql

begin;

do $$
declare
  v_school_a uuid := gen_random_uuid();
  v_school_b uuid := gen_random_uuid();
  v_principal_role uuid;
  v_teacher_role uuid;
  v_principal_auth uuid := gen_random_uuid();
  v_teacher_auth uuid := gen_random_uuid();
  v_principal_su uuid := gen_random_uuid();
  v_teacher_su uuid := gen_random_uuid();
  v_blocked boolean;
  v_count int;
  v_school_after uuid;
begin
  select id into v_principal_role from roles where name = 'principal';
  select id into v_teacher_role from roles where name = 'teacher';
  if v_principal_role is null or v_teacher_role is null then
    raise exception 'FIXTURE SETUP FAILED: roles "principal"/"teacher" not found';
  end if;

  insert into schools (id, name, slug, application_number_prefix) values
    (v_school_a, 'Move Test School A', 'move-test-school-a', 'MTA'),
    (v_school_b, 'Move Test School B', 'move-test-school-b', 'MTB');
  insert into auth.users (id, aud, role, email) values
    (v_principal_auth, 'authenticated', 'authenticated', 'move-test-principal@example.invalid'),
    (v_teacher_auth, 'authenticated', 'authenticated', 'move-test-teacher@example.invalid');
  insert into school_users (id, school_id, auth_user_id, role_id, full_name, status) values
    (v_principal_su, v_school_a, v_principal_auth, v_principal_role, 'Move Test Principal', 'active'),
    (v_teacher_su, v_school_a, v_teacher_auth, v_teacher_role, 'Move Test Teacher', 'active');

  -- 1. Principal tries to move THEMSELVES into school B: must be rejected.
  set local role authenticated;
  perform set_config('request.jwt.claims', json_build_object('sub', v_principal_auth, 'role', 'authenticated')::text, true);
  v_blocked := false;
  begin
    update school_users set school_id = v_school_b where id = v_principal_su;
  exception when others then
    v_blocked := true;
  end;
  reset role;
  if not v_blocked then
    raise exception 'FAIL: principal moved own school_users row to another school';
  end if;

  -- 2. Principal tries to move a colleague into school B: must be rejected.
  set local role authenticated;
  perform set_config('request.jwt.claims', json_build_object('sub', v_principal_auth, 'role', 'authenticated')::text, true);
  v_blocked := false;
  begin
    update school_users set school_id = v_school_b where id = v_teacher_su;
  exception when others then
    v_blocked := true;
  end;
  reset role;
  if not v_blocked then
    raise exception 'FAIL: principal moved a colleague into another school';
  end if;

  select school_id into v_school_after from school_users where id in (v_principal_su) ;
  if v_school_after is distinct from v_school_a then
    raise exception 'FAIL: principal row school_id changed to %', v_school_after;
  end if;

  -- 3. Regression: a principal can still do normal in-school management.
  set local role authenticated;
  perform set_config('request.jwt.claims', json_build_object('sub', v_principal_auth, 'role', 'authenticated')::text, true);
  update school_users set full_name = 'Move Test Teacher Renamed' where id = v_teacher_su;
  get diagnostics v_count = row_count;
  reset role;
  if v_count != 1 then
    raise exception 'REGRESSION: principal can no longer edit a colleague in their own school (% rows)', v_count;
  end if;

  raise notice 'school_users tenant-move behavioral checks: all passed';
end $$;

rollback;

do $$
begin
  if exists (select 1 from schools where slug in ('move-test-school-a', 'move-test-school-b')) then
    raise exception 'LEAK DETECTED: move-test fixture rows were not rolled back';
  end if;
end $$;
