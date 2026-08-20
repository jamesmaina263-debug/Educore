
do $$
declare
  v_user_id uuid := gen_random_uuid();
  v_school_id uuid := '50f09948-2f38-4802-8b19-2efe073197bb';
  v_role_id uuid := '2ac7aada-0039-4d39-ae13-3c3dc185bde7';
  v_email text := 'owner.demo@educore.test';
  v_password text := 'TestOwner!2026#';
begin
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
    jsonb_build_object('full_name', 'Test Owner (Demo Academy)'),
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
    auth_user_id, school_id, role_id, full_name, email, status
  ) values (
    v_user_id, v_school_id, v_role_id, 'Test Owner (Demo Academy)', v_email, 'active'
  );
end $$;
