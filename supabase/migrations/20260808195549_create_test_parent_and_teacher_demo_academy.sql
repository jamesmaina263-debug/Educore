
do $$
declare
  v_school_id uuid := '50f09948-2f38-4802-8b19-2efe073197bb';
  v_student_id uuid := 'e8810bbb-b836-4855-906b-9eb11840f80b';
  v_parent_role_id uuid := '1a564ded-2f01-4888-ade1-296efb70844a';
  v_teacher_role_id uuid := '81cb07b3-8280-4cb1-9b2b-a1a30dacf01e';

  v_parent_user_id uuid := gen_random_uuid();
  v_parent_email text := 'parent.demo@educore.test';
  v_parent_password text := 'TestParent!2026#';
  v_parent_school_user_id uuid;

  v_teacher_user_id uuid := gen_random_uuid();
  v_teacher_email text := 'teacher.demo@educore.test';
  v_teacher_password text := 'TestTeacher!2026#';
begin
  insert into auth.users (
    instance_id, id, aud, role, email, encrypted_password,
    email_confirmed_at, created_at, updated_at,
    raw_app_meta_data, raw_user_meta_data,
    is_super_admin, confirmation_token, recovery_token,
    email_change_token_new, email_change
  ) values (
    '00000000-0000-0000-0000-000000000000', v_parent_user_id, 'authenticated', 'authenticated',
    v_parent_email, crypt(v_parent_password, gen_salt('bf')),
    now(), now(), now(),
    '{"provider":"email","providers":["email"]}'::jsonb,
    jsonb_build_object('full_name', 'Test Parent (Demo Academy)'),
    false, '', '', '', ''
  );
  insert into auth.identities (
    id, user_id, identity_data, provider, provider_id, last_sign_in_at, created_at, updated_at
  ) values (
    gen_random_uuid(), v_parent_user_id,
    jsonb_build_object('sub', v_parent_user_id::text, 'email', v_parent_email),
    'email', v_parent_user_id::text, now(), now(), now()
  );
  insert into school_users (auth_user_id, school_id, role_id, full_name, email, status)
  values (v_parent_user_id, v_school_id, v_parent_role_id, 'Test Parent (Demo Academy)', v_parent_email, 'active')
  returning id into v_parent_school_user_id;

  insert into student_guardians (student_id, guardian_user_id, relationship, primary_contact)
  values (v_student_id, v_parent_school_user_id, 'guardian', true);

  insert into auth.users (
    instance_id, id, aud, role, email, encrypted_password,
    email_confirmed_at, created_at, updated_at,
    raw_app_meta_data, raw_user_meta_data,
    is_super_admin, confirmation_token, recovery_token,
    email_change_token_new, email_change
  ) values (
    '00000000-0000-0000-0000-000000000000', v_teacher_user_id, 'authenticated', 'authenticated',
    v_teacher_email, crypt(v_teacher_password, gen_salt('bf')),
    now(), now(), now(),
    '{"provider":"email","providers":["email"]}'::jsonb,
    jsonb_build_object('full_name', 'Test Teacher (Demo Academy)'),
    false, '', '', '', ''
  );
  insert into auth.identities (
    id, user_id, identity_data, provider, provider_id, last_sign_in_at, created_at, updated_at
  ) values (
    gen_random_uuid(), v_teacher_user_id,
    jsonb_build_object('sub', v_teacher_user_id::text, 'email', v_teacher_email),
    'email', v_teacher_user_id::text, now(), now(), now()
  );
  insert into school_users (auth_user_id, school_id, role_id, full_name, email, status)
  values (v_teacher_user_id, v_school_id, v_teacher_role_id, 'Test Teacher (Demo Academy)', v_teacher_email, 'active');
end $$;
