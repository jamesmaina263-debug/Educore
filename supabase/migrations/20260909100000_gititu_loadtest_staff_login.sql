-- ============================================================================
-- Testing aid: synthetic staff (school_owner) login at Gititu High School,
-- for load-testing the internal dashboard and M-Pesa STK-push flow -- both
-- require staff-level permissions (dashboard reads gate on staff-only
-- permissions; initiate_mpesa_stk_request() explicitly requires
-- finance.write) that no existing test account had. Mirrors the existing
-- Gititu Connect-test-guardian pattern (20260828111355) exactly: no real
-- person's identity is used, clearly-labelled synthetic data, easy to find
-- and remove later if desired.
--
-- Deliberately does NOT create a new student -- reuses the existing
-- "Connect Test Student" (GITITU-CONNECT-TEST-001, from the same prior
-- migration) as the target for STK-push load testing, rather than adding a
-- second synthetic student where one already serves the purpose.
-- ============================================================================

do $$
declare
  v_school_id uuid := '1dea95ea-c9b6-46da-9c07-aba712c84d61';
  v_owner_role_id uuid;

  v_staff_user_id uuid := gen_random_uuid();
  v_staff_email text := 'loadtest.staff@educore.test';
  v_staff_password text := 'LoadTestStaff!2026#';
begin
  select id into v_owner_role_id from public.roles where name = 'school_owner';

  insert into auth.users (
    instance_id, id, aud, role, email, encrypted_password,
    email_confirmed_at, created_at, updated_at,
    raw_app_meta_data, raw_user_meta_data,
    is_super_admin, confirmation_token, recovery_token,
    email_change_token_new, email_change
  ) values (
    '00000000-0000-0000-0000-000000000000', v_staff_user_id, 'authenticated', 'authenticated',
    v_staff_email, crypt(v_staff_password, gen_salt('bf')),
    now(), now(), now(),
    '{"provider":"email","providers":["email"]}'::jsonb,
    jsonb_build_object('full_name', 'Load Test Staff'),
    false, '', '', '', ''
  );
  insert into auth.identities (
    id, user_id, identity_data, provider, provider_id, last_sign_in_at, created_at, updated_at
  ) values (
    gen_random_uuid(), v_staff_user_id,
    jsonb_build_object('sub', v_staff_user_id::text, 'email', v_staff_email),
    'email', v_staff_user_id::text, now(), now(), now()
  );
  insert into public.school_users (auth_user_id, school_id, role_id, full_name, email, status)
  values (v_staff_user_id, v_school_id, v_owner_role_id, 'Load Test Staff', v_staff_email, 'active');
end $$;
