-- ============================================================================
-- Convention: reusable, idempotent QA/test staff login provisioning.
--
-- Problem this fixes: multiple past migrations (e.g. gititu_loadtest_staff_login,
-- create_qa_test_account_little_beginners) each hand-rolled a fresh synthetic
-- staff account via raw INSERTs into auth.users/auth.identities/school_users,
-- with no check for an existing one. Every time a session needed a test login
-- for a school it wrote a brand-new one-off migration, so deleting the account
-- never stopped a lookalike from being recreated later under a different id.
--
-- Fix: a single idempotent function. Any future session that needs a QA login
-- for a school should call this instead of writing a bespoke INSERT migration.
-- It derives a fixed, predictable email from the school's name, checks for an
-- existing school_users row with that email first, and no-ops (returning the
-- existing id) if one is already there -- so it is always safe to re-run and
-- will never spawn duplicates or lookalikes.
--
-- Usage:  select public.ensure_qa_test_account('<school_id>');
-- To remove a QA account later: delete the returned school_users row (and its
-- matching auth.users/auth.identities row via auth_user_id) as usual -- a
-- fresh call to this function afterwards will simply recreate the one, fixed
-- account, never a duplicate.
-- ============================================================================

create or replace function public.ensure_qa_test_account(
  p_school_id uuid,
  p_password text default 'QaTest!2026#'
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_school_name text;
  v_slug text;
  v_email text;
  v_existing_id uuid;
  v_auth_user_id uuid;
  v_owner_role_id uuid;
begin
  select name into v_school_name from public.schools where id = p_school_id;
  if v_school_name is null then
    raise exception 'ensure_qa_test_account: school % not found', p_school_id;
  end if;

  v_slug := lower(regexp_replace(v_school_name, '[^a-zA-Z0-9]+', '', 'g'));
  v_email := 'qa-' || v_slug || '@educore.test';

  -- Idempotency check: reuse the existing account instead of creating another.
  select id into v_existing_id
  from public.school_users
  where school_id = p_school_id and email = v_email;

  if v_existing_id is not null then
    return v_existing_id;
  end if;

  select id into v_owner_role_id from public.roles where name = 'school_owner';

  v_auth_user_id := gen_random_uuid();

  insert into auth.users (
    instance_id, id, aud, role, email, encrypted_password,
    email_confirmed_at, created_at, updated_at,
    raw_app_meta_data, raw_user_meta_data,
    is_super_admin, confirmation_token, recovery_token,
    email_change_token_new, email_change
  ) values (
    '00000000-0000-0000-0000-000000000000', v_auth_user_id, 'authenticated', 'authenticated',
    v_email, crypt(p_password, gen_salt('bf')),
    now(), now(), now(),
    '{"provider":"email","providers":["email"]}'::jsonb,
    jsonb_build_object('full_name', 'QA Test Account (' || v_school_name || ')'),
    false, '', '', '', ''
  );

  insert into auth.identities (
    id, user_id, identity_data, provider, provider_id, last_sign_in_at, created_at, updated_at
  ) values (
    gen_random_uuid(), v_auth_user_id,
    jsonb_build_object('sub', v_auth_user_id::text, 'email', v_email),
    'email', v_auth_user_id::text, now(), now(), now()
  );

  insert into public.school_users (auth_user_id, school_id, role_id, full_name, email, status)
  values (v_auth_user_id, p_school_id, v_owner_role_id, 'QA Test Account (' || v_school_name || ')', v_email, 'active')
  returning id into v_existing_id;

  return v_existing_id;
end;
$$;

comment on function public.ensure_qa_test_account(uuid, text) is
  'Idempotent QA/test staff login provisioning. Call instead of writing a one-off '
  'INSERT migration for a synthetic staff account: derives a fixed email per school '
  '(qa-<slug>@educore.test), no-ops if that school_users row already exists, and '
  'otherwise creates exactly one. Prevents the lookalike-QA-account-recreated-by-a- '
  'fresh-migration pattern seen with create_qa_test_account_little_beginners and '
  'gititu_loadtest_staff_login.';
