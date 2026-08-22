
do $$
declare
  v_user_id uuid := gen_random_uuid();
  v_school_id uuid := '50f09948-2f38-4802-8b19-2efe073197bb';
  v_role_id uuid;
  v_email text := 'owner.demo@educore.test';
  v_password text := 'TestOwner!2026#';
begin
  -- Demo Academy is referenced by fixed id across several later demo/seed migrations
  -- (parent/teacher accounts, nurse account, health module seed data). Create it here
  -- idempotently with its known live id so the whole chain replays on a fresh environment.
  -- No-op on databases where it already exists (matches live: name/slug/status below).
  insert into schools (id, name, slug, status)
  values (v_school_id, 'Demo Academy', 'demo-academy', 'trial')
  on conflict (id) do nothing;

  -- roles.id is gen_random_uuid()-generated, not a stable/portable value across
  -- environments, so look the role up by name rather than hardcoding its live id.
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
