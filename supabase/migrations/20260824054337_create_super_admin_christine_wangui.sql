-- NOTE (reconciliation, Aug 27 2026): the password literal actually used in production has
-- been replaced with the placeholder below before committing to this public repository. This
-- account was created and then revoked again ~3 minutes later in production
-- (see 20260824054655_revoke_super_admin_christine_wangui.sql) -- it no longer exists. This
-- file is kept for historical/audit completeness of the migration timeline only; it is not
-- safe to re-run as-is (it would create an account with a placeholder password). If this
-- account ever needs to be recreated, generate a fresh random password and set it directly
-- against the target environment rather than re-running this file.
do $$
declare
  v_user_id uuid := gen_random_uuid();
  v_role_id uuid;
  v_email text := 'christinewangui998@gmail.com';
  v_password text := '<REDACTED-SET-A-NEW-RANDOM-PASSWORD-IF-RE-RUNNING>';
begin
  select id into v_role_id from public.roles where name = 'super_admin';
  if v_role_id is null then
    raise exception 'super_admin role not found';
  end if;

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
    jsonb_build_object('full_name', 'Christine Wangui'),
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

  -- super_admin accounts must not be scoped to a single school_id (enforce_school_user_scope
  -- trigger) -- this is exactly the constraint that blocked creating this from the school-scoped
  -- Add Staff dialog. school_id and school_group_id both left null.
  insert into school_users (
    auth_user_id, school_id, role_id, full_name, email, status
  ) values (
    v_user_id, null, v_role_id, 'Christine Wangui', v_email, 'active'
  );
end $$;
