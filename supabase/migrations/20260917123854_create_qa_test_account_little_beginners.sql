-- Throwaway QA login for Little Beginners School, so Lucy can click through the boarding
-- module change herself without touching the real owner Victor Ng'ang'a's account. Same
-- shape as inviteStaffMember() / the Demo Academy test-owner account (see
-- 20260808194751_create_test_school_owner_demo_academy.sql): must_change_password + a short
-- temp-password expiry, matching the staff-forced-password-change convention.
do $$
declare
  v_user_id uuid := gen_random_uuid();
  v_school_id uuid := 'bc0e14ef-25ed-492d-8999-8d9718c3c2d1'; -- Little Beginners School
  v_role_id uuid;
  v_email text := 'qa-littlebeginners@educore.test';
  v_password text := 'LittleBeginnersQA!2026#';
begin
  select id into v_role_id from public.roles where name = 'school_owner';

  insert into auth.users (
    instance_id, id, aud, role, email, encrypted_password,
    email_confirmed_at, created_at, updated_at,
    raw_app_meta_data, raw_user_meta_data,
    is_super_admin, confirmation_token, recovery_token,
    email_change_token_new, email_change
  ) values (
    '00000000-0000-0000-0000-000000000000', v_user_id, 'authenticated', 'authenticated',
    v_email, crypt(v_password, gen_salt('bf')),
    now(), now(), now(),
    '{"provider":"email","providers":["email"]}'::jsonb,
    jsonb_build_object('full_name', 'QA Test Account (Little Beginners)'),
    false, '', '', '', ''
  );

  insert into auth.identities (
    id, user_id, identity_data, provider, provider_id,
    last_sign_in_at, created_at, updated_at
  ) values (
    gen_random_uuid(), v_user_id,
    jsonb_build_object('sub', v_user_id::text, 'email', v_email),
    'email', v_user_id::text,
    now(), now(), now()
  );

  insert into school_users (
    auth_user_id, school_id, role_id, full_name, email, status,
    must_change_password, temp_password_expires_at
  ) values (
    v_user_id, v_school_id, v_role_id, 'QA Test Account (Little Beginners)', v_email, 'active',
    true, now() + interval '3 days'
  );
end $$;
