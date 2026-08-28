-- ============================================================================
-- Testing aid: synthetic test student + guardian login inside Mugisha ronald's
-- real class (S.B / S.1B) at Gititu High School, mirroring the existing
-- "Test Parent (Demo Academy)" / "Test Teacher (Demo Academy)" pattern
-- (20260808195549) so Educore Connect can be click-tested end-to-end without
-- touching any real guardian's actual account (Gititu's other guardians in
-- this class have real emails/phones on file -- deliberately not used here).
--
-- Clearly-labelled synthetic data throughout: name "Connect Test Student",
-- admission number "GITITU-CONNECT-TEST-001", guardian email
-- @educore.test -- easy to find and remove later if desired.
-- ============================================================================

do $$
declare
  v_school_id uuid := '1dea95ea-c9b6-46da-9c07-aba712c84d61';
  v_stream_id uuid := '9858e4b4-6216-4c1e-90a9-31e88cc8e028'; -- S.B, Mugisha ronald's class
  v_student_id uuid := gen_random_uuid();
  v_parent_role_id uuid;

  v_guardian_user_id uuid := gen_random_uuid();
  v_guardian_email text := 'connect.test.guardian@educore.test';
  v_guardian_password text := 'ConnectTest!2026#';
  v_guardian_school_user_id uuid;
begin
  select id into v_parent_role_id from public.roles where name = 'parent';

  insert into public.students (id, school_id, admission_number, first_name, last_name, date_of_birth, gender, current_class_id, status)
  values (v_student_id, v_school_id, 'GITITU-CONNECT-TEST-001', 'Connect', 'Test Student', '2011-05-20', 'male', v_stream_id, 'applied');

  insert into auth.users (
    instance_id, id, aud, role, email, encrypted_password,
    email_confirmed_at, created_at, updated_at,
    raw_app_meta_data, raw_user_meta_data,
    is_super_admin, confirmation_token, recovery_token,
    email_change_token_new, email_change
  ) values (
    '00000000-0000-0000-0000-000000000000', v_guardian_user_id, 'authenticated', 'authenticated',
    v_guardian_email, crypt(v_guardian_password, gen_salt('bf')),
    now(), now(), now(),
    '{"provider":"email","providers":["email"]}'::jsonb,
    jsonb_build_object('full_name', 'Connect Test Guardian'),
    false, '', '', '', ''
  );
  insert into auth.identities (
    id, user_id, identity_data, provider, provider_id, last_sign_in_at, created_at, updated_at
  ) values (
    gen_random_uuid(), v_guardian_user_id,
    jsonb_build_object('sub', v_guardian_user_id::text, 'email', v_guardian_email),
    'email', v_guardian_user_id::text, now(), now(), now()
  );
  insert into public.school_users (auth_user_id, school_id, role_id, full_name, email, status)
  values (v_guardian_user_id, v_school_id, v_parent_role_id, 'Connect Test Guardian', v_guardian_email, 'active')
  returning id into v_guardian_school_user_id;

  insert into public.student_guardians (student_id, guardian_user_id, relationship, primary_contact)
  values (v_student_id, v_guardian_school_user_id, 'guardian', true);

  -- Same status-transition chain as the Demo Academy seed migration -- a
  -- primary-contact guardian is required before status can leave 'applied'.
  update public.students set status = 'approved' where id = v_student_id;
  update public.students set status = 'enrolled' where id = v_student_id;
  update public.students set status = 'active' where id = v_student_id;
end $$;
