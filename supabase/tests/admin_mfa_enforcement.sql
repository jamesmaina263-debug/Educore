-- Behavioral test for the admin MFA scaffold (20261017090000). Same safety model as
-- school_users_tenant_move_rls.sql: synthetic fixtures, authenticated role + request.jwt.claims,
-- everything inside one transaction that ends in rollback. Run on STAGING or a branch, not for
-- the first time on production:
--   psql "$SUPABASE_DB_URL" -v ON_ERROR_STOP=1 -f supabase/tests/admin_mfa_enforcement.sql
-- (It does not need any real user: it creates and rolls back its own.)

begin;

do $$
declare
  v_role uuid;
  v_admin uuid := gen_random_uuid();
  v_pinned uuid := gen_random_uuid();
  v_rogue uuid := gen_random_uuid();
  v_ok boolean;
begin
  select id into v_role from roles where name = 'super_admin';
  if v_role is null then raise exception 'FIXTURE SETUP FAILED: super_admin role not found'; end if;

  insert into auth.users (id, aud, role, email) values (v_admin, 'authenticated', 'authenticated', 'mfa-test-admin@example.invalid');
  insert into school_users (id, auth_user_id, role_id, full_name, status)
    values (gen_random_uuid(), v_admin, v_role, 'MFA Test Admin', 'active');

  -- 1. Flag OFF (the state this ships in): aal1 super admin is accepted, exactly as before.
  update platform_security_settings set bool_value = false where key = 'admin_mfa_required';
  set local role authenticated;
  perform set_config('request.jwt.claims', json_build_object('sub', v_admin, 'role', 'authenticated', 'aal', 'aal1')::text, true);
  select auth_is_super_admin() into v_ok;
  reset role;
  if v_ok is not true then raise exception 'FAIL: flag off, aal1 super admin should still be accepted'; end if;

  -- 2. set_admin_mfa_required(true) must REFUSE while there are no verified factors.
  begin
    perform set_admin_mfa_required(true, 1);
    raise exception 'FAIL: enforcement turned on with zero verified factors';
  exception when others then
    if sqlerrm like 'FAIL:%' then raise; end if;
  end;

  -- 3. Give the admin one verified TOTP factor, then enforcement may be turned on.
  insert into auth.mfa_factors (id, user_id, friendly_name, factor_type, status, created_at, updated_at)
    values (v_pinned, v_admin, 'Ben', 'totp', 'verified', now(), now());
  perform set_admin_mfa_required(true, 1);

  -- 4. Flag ON: aal1 is refused, aal2 is accepted.
  set local role authenticated;
  perform set_config('request.jwt.claims', json_build_object('sub', v_admin, 'role', 'authenticated', 'aal', 'aal1')::text, true);
  select auth_is_super_admin() into v_ok;
  reset role;
  if v_ok is not false then raise exception 'FAIL: flag on, aal1 session must be refused'; end if;

  set local role authenticated;
  perform set_config('request.jwt.claims', json_build_object('sub', v_admin, 'role', 'authenticated', 'aal', 'aal2')::text, true);
  select auth_is_super_admin() into v_ok;
  reset role;
  if v_ok is not true then raise exception 'FAIL: flag on, aal2 session with the pinned factor must be accepted'; end if;

  -- 5. The "any assurance level" variant still sees the admin at aal1 (needed to reach the MFA page).
  set local role authenticated;
  perform set_config('request.jwt.claims', json_build_object('sub', v_admin, 'role', 'authenticated', 'aal', 'aal1')::text, true);
  select auth_is_super_admin_any_aal() into v_ok;
  reset role;
  if v_ok is not true then raise exception 'FAIL: any_aal variant should accept aal1 admin'; end if;

  -- 6. A verified factor NOT in the pinned set (rogue enrolment) makes even aal2 fail closed.
  insert into auth.mfa_factors (id, user_id, friendly_name, factor_type, status, created_at, updated_at)
    values (v_rogue, v_admin, 'Attacker', 'totp', 'verified', now(), now());
  set local role authenticated;
  perform set_config('request.jwt.claims', json_build_object('sub', v_admin, 'role', 'authenticated', 'aal', 'aal2')::text, true);
  select auth_is_super_admin() into v_ok;
  reset role;
  if v_ok is not false then raise exception 'FAIL: unpinned verified factor must be refused'; end if;

  -- 7. Rollback switch works, and restores previous behaviour immediately.
  perform set_admin_mfa_required(false);
  set local role authenticated;
  perform set_config('request.jwt.claims', json_build_object('sub', v_admin, 'role', 'authenticated', 'aal', 'aal1')::text, true);
  select auth_is_super_admin() into v_ok;
  reset role;
  if v_ok is not true then raise exception 'FAIL: after turning enforcement off, aal1 super admin should work again'; end if;

  -- 8. Authenticated users cannot flip the switch.
  set local role authenticated;
  perform set_config('request.jwt.claims', json_build_object('sub', v_admin, 'role', 'authenticated', 'aal', 'aal2')::text, true);
  begin
    perform set_admin_mfa_required(false);
    reset role;
    raise exception 'FAIL: authenticated role could call set_admin_mfa_required';
  exception when insufficient_privilege then
    reset role;
  end;

  raise notice 'admin_mfa_enforcement: all checks passed';
end;
$$;

rollback;
