
do $$
declare
  v_school_id uuid;
  v_student_id uuid := 'e8810bbb-b836-4855-906b-9eb11840f80b';
  v_parent_role_id uuid;
  v_teacher_role_id uuid;

  v_parent_user_id uuid := gen_random_uuid();
  v_parent_email text := 'parent.demo@educore.test';
  v_parent_password text := 'TestParent!2026#';
  v_parent_school_user_id uuid;

  v_teacher_user_id uuid := gen_random_uuid();
  v_teacher_email text := 'teacher.demo@educore.test';
  v_teacher_password text := 'TestTeacher!2026#';
begin
  -- Look up Demo Academy by its stable slug rather than assuming a hardcoded id exists.
  select id into v_school_id from public.schools where slug = 'demo-academy';

  -- roles.id is gen_random_uuid()-generated, not portable across environments;
  -- look roles up by name instead of hardcoding their live ids.
  select id into v_parent_role_id from public.roles where name = 'parent';
  select id into v_teacher_role_id from public.roles where name = 'teacher';

  -- This demo student ("Alex") is also referenced by the health module demo seed
  -- migration. Create idempotently with a fixed id so both migrations stay in sync
  -- on a fresh environment. Inserted as 'applied' because a trigger requires a
  -- primary-contact guardian before status can be enrolled/active, and the guardian
  -- (Test Parent, below) doesn't exist yet at this point.
  insert into students (id, school_id, admission_number, first_name, last_name, date_of_birth, gender, status)
  values (v_student_id, v_school_id, 'DEMO-ALEX-001', 'Alex', 'Demo', '2015-03-14', 'female', 'applied')
  on conflict (id) do nothing;

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
  select v_student_id, v_parent_school_user_id, 'guardian', true
  where not exists (select 1 from student_guardians where student_id = v_student_id);

  -- Status transitions are restricted (applied -> approved -> enrolled -> active); walk
  -- the chain now that a primary-contact guardian exists.
  update students set status = 'approved' where id = v_student_id and status = 'applied';
  update students set status = 'enrolled' where id = v_student_id and status = 'approved';
  update students set status = 'active' where id = v_student_id and status = 'enrolled';

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
