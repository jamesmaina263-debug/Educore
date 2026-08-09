-- Demo nurse login for the Health module prospect demo.
-- Real authenticated account, so RLS policies apply exactly as they would in production —
-- this is not a service-role bypass.
do $$
declare
  v_user_id uuid;
  v_school_id uuid := '50f09948-2f38-4802-8b19-2efe073197bb';
  v_nurse_role_id uuid;
begin
  select id into v_nurse_role_id from public.roles where name = 'nurse';

  if not exists (select 1 from auth.users where email = 'nurse.demo@educore.app') then
    v_user_id := gen_random_uuid();
    insert into auth.users (
      id, instance_id, email, encrypted_password, email_confirmed_at,
      raw_app_meta_data, raw_user_meta_data, created_at, updated_at, aud, role
    ) values (
      v_user_id, '00000000-0000-0000-0000-000000000000', 'nurse.demo@educore.app',
      crypt('EduCoreDemo!2026', gen_salt('bf')), now(),
      '{"provider":"email","providers":["email"]}', '{}', now(), now(), 'authenticated', 'authenticated'
    );

    insert into public.school_users (auth_user_id, school_id, role_id, full_name, email, status)
    values (v_user_id, v_school_id, v_nurse_role_id, 'Nurse Demo (School Nurse)', 'nurse.demo@educore.app', 'active');
  end if;
end $$;
