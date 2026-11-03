-- Behavioural test for Phase 8.2 (migration *_ai_tutor_drafts). Rollback-only, synthetic fixtures, real role
-- impersonation (request.jwt.claims). One transaction ending in `rollback;`; a final tripwire fails loudly if any
-- fixture row persisted.
--   psql "$SUPABASE_DB_URL" -v ON_ERROR_STOP=1 -f supabase/tests/ai_tutor.sql
begin;

do $$
declare
  sa uuid := gen_random_uuid(); sb uuid := gen_random_uuid();
  ay uuid := gen_random_uuid(); cl uuid := gen_random_uuid();
  st1 uuid := gen_random_uuid(); st2 uuid := gen_random_uuid(); stb uuid := gen_random_uuid();
  sj uuid := gen_random_uuid(); sjb uuid := gen_random_uuid();
  u_t1 uuid := gen_random_uuid(); u_t2 uuid := gen_random_uuid(); u_dp uuid := gen_random_uuid();
  u_p1 uuid := gen_random_uuid(); u_p2 uuid := gen_random_uuid(); u_stu uuid := gen_random_uuid(); u_tb uuid := gen_random_uuid();
  su_t1 uuid := gen_random_uuid(); su_t2 uuid := gen_random_uuid(); su_dp uuid := gen_random_uuid();
  su_p1 uuid := gen_random_uuid(); su_p2 uuid := gen_random_uuid(); su_stu uuid := gen_random_uuid(); su_tb uuid := gen_random_uuid();
  ch1 uuid := gen_random_uuid(); ch2 uuid := gen_random_uuid();
  r_teacher uuid; r_dp uuid; r_parent uuid; r_student uuid; v_cat uuid; v_flag_portal uuid; v_flag_tutor uuid;
  n1 uuid; n2 uuid; n_draft uuid; n_other uuid; vid uuid;
  d1 uuid; d2 uuid; req uuid; v_n integer; v_failed boolean; v_state text;
begin
  select id into r_teacher from roles where name = 'teacher';
  select id into r_dp from roles where name = 'deputy_principal';
  select id into r_parent from roles where name = 'parent';
  select id into r_student from roles where name = 'student';
  select id into v_cat from subject_catalogue limit 1;
  assert r_teacher is not null and r_dp is not null and r_parent is not null and r_student is not null and v_cat is not null, 'seed roles/catalogue exist';

  insert into schools (id, name, slug, application_number_prefix) values
    (sa, 'Tutor Test A', 'tutor-test-a', 'TTA'), (sb, 'Tutor Test B', 'tutor-test-b', 'TTB');
  insert into auth.users (id, aud, role, email) values
    (u_t1, 'authenticated', 'authenticated', 'tutor-t1@example.invalid'),
    (u_t2, 'authenticated', 'authenticated', 'tutor-t2@example.invalid'),
    (u_dp, 'authenticated', 'authenticated', 'tutor-dp@example.invalid'),
    (u_p1, 'authenticated', 'authenticated', 'tutor-p1@example.invalid'),
    (u_p2, 'authenticated', 'authenticated', 'tutor-p2@example.invalid'),
    (u_stu, 'authenticated', 'authenticated', 'tutor-stu@example.invalid'),
    (u_tb, 'authenticated', 'authenticated', 'tutor-tb@example.invalid');
  insert into school_users (id, school_id, auth_user_id, role_id, full_name, status) values
    (su_t1, sa, u_t1, r_teacher, 'Tutor Teacher 1', 'active'),
    (su_t2, sa, u_t2, r_teacher, 'Tutor Teacher 2', 'active'),
    (su_dp, sa, u_dp, r_dp, 'Tutor Deputy', 'active'),
    (su_p1, sa, u_p1, r_parent, 'Tutor Parent 1', 'active'),
    (su_p2, sa, u_p2, r_parent, 'Tutor Parent 2', 'active'),
    (su_stu, sa, u_stu, r_student, 'Tutor Student', 'active'),
    (su_tb, sb, u_tb, r_teacher, 'Tutor Teacher B', 'active');
  insert into academic_years (id, school_id, name, start_date, end_date) values (ay, sa, 'Tutor Year', '2026-01-01', '2026-12-31');
  insert into classes (id, school_id, academic_year_id, name, level_order) values (cl, sa, ay, 'Tutor Class', 1);
  insert into streams (id, school_id, class_id, name) values (st1, sa, cl, 'North'), (st2, sa, cl, 'South');
  insert into subjects (id, school_id, name, catalogue_id) values (sj, sa, 'Tutor Subject', v_cat);
  insert into students (id, school_id, first_name, last_name, date_of_birth, gender, status) values
    (ch1, sa, 'Kid', 'One', date '2012-01-01', 'male', 'approved'),
    (ch2, sa, 'Kid', 'Two', date '2012-01-02', 'female', 'approved');
  update students set current_class_id = st1, school_user_id = su_stu where id = ch1;
  update students set current_class_id = st2 where id = ch2;
  insert into student_guardians (student_id, guardian_user_id, relationship, primary_contact) values
    (ch1, su_p1, 'guardian', true), (ch2, su_p2, 'guardian', true);

  select id into v_flag_portal from platform_feature_flags where key = 'feature.learning.portal';
  select id into v_flag_tutor from platform_feature_flags where key = 'feature.learning.ai_tutor';
  assert v_flag_portal is not null and v_flag_tutor is not null, 'flag catalog entries exist (8.1 and 8.2)';

  -- 1. both flags off, then only the portal flag: the tutor refuses with 55000
  execute 'set local role authenticated';
  perform set_config('request.jwt.claims', json_build_object('sub', u_t1, 'role', 'authenticated')::text, true);
  v_failed := false;
  begin perform claim_tutor_request('key-flags-off-1', 'v1');
  exception when others then get stacked diagnostics v_state = returned_sqlstate; v_failed := (v_state = '55000'); end;
  assert v_failed, '1: both flags off refuses with 55000';
  execute 'reset role';
  insert into school_feature_flags (school_id, flag_id, enabled) values (sa, v_flag_portal, true);
  execute 'set local role authenticated';
  perform set_config('request.jwt.claims', json_build_object('sub', u_t1, 'role', 'authenticated')::text, true);
  v_failed := false;
  begin perform claim_tutor_request('key-flags-off-2', 'v1');
  exception when others then get stacked diagnostics v_state = returned_sqlstate; v_failed := (v_state = '55000'); end;
  assert v_failed, '1: portal flag alone is not enough';
  execute 'reset role';
  insert into school_feature_flags (school_id, flag_id, enabled) values (sa, v_flag_tutor, true);

  -- 2. teacher 1 makes material
  execute 'set local role authenticated';
  perform set_config('request.jwt.claims', json_build_object('sub', u_t1, 'role', 'authenticated')::text, true);
  n1 := save_learning_resource(null, st1, sj, 'note', 'Fractions notes', 'A fraction is a part of a whole.', null, null, null, true);
  n2 := save_learning_resource(null, st1, sj, 'note', 'Decimals notes', 'A decimal uses a point.', null, null, null, true);
  n_draft := save_learning_resource(null, st1, sj, 'note', 'Unpublished notes', 'Not ready yet.', null, null, null, false);
  vid := save_learning_resource(null, st1, sj, 'video', 'A video', null, 'https://example.invalid/v/1', null, null, true);
  n_other := save_learning_resource(null, st2, sj, 'note', 'South stream notes', 'Different class.', null, null, null, true);

  -- 3. grounding is enforced by the database
  v_failed := false; begin perform save_tutor_draft(st1, sj, 'T', 'Body', array[n_draft], 'm', 'v1'); exception when sqlstate '22023' then v_failed := true; end;
  assert v_failed, '3: an unpublished note cannot be a source';
  v_failed := false; begin perform save_tutor_draft(st1, sj, 'T', 'Body', array[vid], 'm', 'v1'); exception when sqlstate '22023' then v_failed := true; end;
  assert v_failed, '3: a video cannot be a source (only notes carry readable text)';
  v_failed := false; begin perform save_tutor_draft(st1, sj, 'T', 'Body', array[n_other], 'm', 'v1'); exception when sqlstate '22023' then v_failed := true; end;
  assert v_failed, '3: a note from another class cannot be a source';
  v_failed := false; begin perform save_tutor_draft(st1, sj, 'T', 'Body', array[]::uuid[], 'm', 'v1'); exception when sqlstate '22023' then v_failed := true; end;
  assert v_failed, '3: no sources refused';
  v_failed := false; begin perform save_tutor_draft(st1, sj, 'T', 'Body', array[n1, gen_random_uuid()], 'm', 'v1'); exception when sqlstate '22023' then v_failed := true; end;
  assert v_failed, '3: an unknown source id refused';
  v_failed := false; begin perform save_tutor_draft(st1, sj, '   ', 'Body', array[n1], 'm', 'v1'); exception when sqlstate '22023' then v_failed := true; end;
  assert v_failed, '3: blank title refused';

  -- 4. request claim + finish
  req := claim_tutor_request('key-good-0001', 'v1');
  v_failed := false; begin perform claim_tutor_request('key-good-0001', 'v1'); exception when sqlstate '23505' then v_failed := true; end;
  assert v_failed, '4: duplicate idempotency key refused';
  d1 := save_tutor_draft(st1, sj, 'Fractions study guide', 'Study guide text', array[n1, n1, n2], 'gemini-test', 'v1');
  perform finish_tutor_request(req, 'succeeded', null, 1200, 500, 300, d1);
  v_failed := false; begin perform finish_tutor_request(req, 'failed', 'x', 1, 1, 1, null); exception when sqlstate 'P0002' then v_failed := true; end;
  assert v_failed, '4: a finished request cannot be finished again';
  assert (select status from tutor_ai_requests where id = req) = 'succeeded', '4: request recorded';
  assert (select cardinality(source_resource_ids) from tutor_drafts where id = d1) = 2, '4: duplicate sources collapsed';
  assert (select count(*) from jsonb_array_elements((select source_snapshot from tutor_drafts where id = d1)) e where e->>'title' in ('Fractions notes', 'Decimals notes')) = 2, '4: source titles copied from the database';
  assert (select status from tutor_drafts where id = d1) = 'draft', '4: starts as a draft';

  -- 5. a draft is invisible to learners and parents, visible to staff
  perform set_config('request.jwt.claims', json_build_object('sub', u_p1, 'role', 'authenticated')::text, true);
  assert (select count(*) from tutor_drafts) = 0, '5: parent cannot see a draft';
  perform set_config('request.jwt.claims', json_build_object('sub', u_stu, 'role', 'authenticated')::text, true);
  assert (select count(*) from tutor_drafts) = 0, '5: student cannot see a draft';
  perform set_config('request.jwt.claims', json_build_object('sub', u_t2, 'role', 'authenticated')::text, true);
  assert (select count(*) from tutor_drafts) = 1, '5: other teacher (staff) can see it';

  -- 6. only the author (or academics.write) may edit or review
  v_failed := false; begin perform update_tutor_draft(d1, 'Hijack', 'Hijacked'); exception when sqlstate '42501' then v_failed := true; end;
  assert v_failed, '6: another teacher cannot edit';
  v_failed := false; begin perform review_tutor_draft(d1, 'approve'); exception when sqlstate '42501' then v_failed := true; end;
  assert v_failed, '6: another teacher cannot approve';
  perform set_config('request.jwt.claims', json_build_object('sub', u_t1, 'role', 'authenticated')::text, true);
  perform update_tutor_draft(d1, 'Fractions study guide v2', 'Edited study guide text');
  assert (select title from tutor_drafts where id = d1) = 'Fractions study guide v2', '6: author can edit while a draft';
  v_failed := false; begin insert into tutor_drafts (school_id, stream_id, subject_id, title, body, source_resource_ids, source_snapshot, prompt_version) values (sa, st1, sj, 't', 'b', array[n1], '[]', 'v1'); exception when others then v_failed := true; end;
  assert v_failed, '6: no direct inserts';

  -- 7. approve: now learners of that class see it, learners of the other class do not
  perform review_tutor_draft(d1, 'approve');
  assert (select status from tutor_drafts where id = d1) = 'approved', '7: approved';
  v_failed := false; begin perform review_tutor_draft(d1, 'approve'); exception when sqlstate '22023' then v_failed := true; end;
  assert v_failed, '7: cannot approve twice';
  v_failed := false; begin perform update_tutor_draft(d1, 'x', 'y'); exception when sqlstate '22023' then v_failed := true; end;
  assert v_failed, '7: an approved guide is frozen';
  perform set_config('request.jwt.claims', json_build_object('sub', u_p1, 'role', 'authenticated')::text, true);
  assert (select count(*) from tutor_drafts where id = d1) = 1, '7: guardian of a child in that class sees it';
  perform set_config('request.jwt.claims', json_build_object('sub', u_stu, 'role', 'authenticated')::text, true);
  assert (select count(*) from tutor_drafts where id = d1) = 1, '7: the student sees it';
  perform set_config('request.jwt.claims', json_build_object('sub', u_p2, 'role', 'authenticated')::text, true);
  assert (select count(*) from tutor_drafts) = 0, '7: guardian of a child in another class sees nothing';

  -- 8. a source that is unpublished, or changed after the draft, hides the guide
  execute 'reset role';
  update learning_resources set published = false where id = n2;
  execute 'set local role authenticated';
  perform set_config('request.jwt.claims', json_build_object('sub', u_p1, 'role', 'authenticated')::text, true);
  assert (select count(*) from tutor_drafts where id = d1) = 0, '8: unpublishing a source hides the guide from learners';
  execute 'reset role';
  update learning_resources set published = true where id = n2;
  execute 'set local role authenticated';
  perform set_config('request.jwt.claims', json_build_object('sub', u_p1, 'role', 'authenticated')::text, true);
  assert (select count(*) from tutor_drafts where id = d1) = 1, '8: republishing the unchanged source shows it again';
  execute 'reset role';
  update learning_resources set updated_at = now() + interval '1 minute' where id = n1;
  execute 'set local role authenticated';
  perform set_config('request.jwt.claims', json_build_object('sub', u_p1, 'role', 'authenticated')::text, true);
  assert (select count(*) from tutor_drafts where id = d1) = 0, '8: editing a source after approval hides the guide';

  -- 9. approving is blocked when a source changed after the draft was written
  perform set_config('request.jwt.claims', json_build_object('sub', u_t1, 'role', 'authenticated')::text, true);
  d2 := save_tutor_draft(st1, sj, 'Decimals guide', 'Decimals text', array[n2], 'gemini-test', 'v1');
  execute 'reset role';
  update learning_resources set updated_at = now() + interval '1 minute' where id = n2;
  execute 'set local role authenticated';
  perform set_config('request.jwt.claims', json_build_object('sub', u_t1, 'role', 'authenticated')::text, true);
  v_failed := false; begin perform review_tutor_draft(d2, 'approve'); exception when sqlstate '22023' then v_failed := true; end;
  assert v_failed, '9: a stale draft cannot be approved';
  perform review_tutor_draft(d2, 'reject');
  assert (select status from tutor_drafts where id = d2) = 'rejected', '9: but it can be rejected';

  -- 10. the deputy (academics.write) can withdraw an approved guide
  execute 'reset role';
  update learning_resources set updated_at = now() - interval '1 day' where id in (n1, n2);
  update tutor_drafts set status = 'approved', reviewed_by = su_t1, reviewed_at = now() where id = d1;
  execute 'set local role authenticated';
  perform set_config('request.jwt.claims', json_build_object('sub', u_dp, 'role', 'authenticated')::text, true);
  perform review_tutor_draft(d1, 'withdraw');
  assert (select status from tutor_drafts where id = d1) = 'rejected', '10: withdrawn';
  v_failed := false; begin perform review_tutor_draft(d1, 'withdraw'); exception when sqlstate '22023' then v_failed := true; end;
  assert v_failed, '10: only an approved guide can be withdrawn';

  -- 11. another school: nothing visible, cannot use school A's classes or notes
  execute 'reset role';
  insert into school_feature_flags (school_id, flag_id, enabled) values (sb, v_flag_portal, true), (sb, v_flag_tutor, true);
  execute 'set local role authenticated';
  perform set_config('request.jwt.claims', json_build_object('sub', u_tb, 'role', 'authenticated')::text, true);
  assert (select count(*) from tutor_drafts) = 0, '11: school B sees no drafts';
  assert (select count(*) from tutor_ai_requests) = 0, '11: school B sees no requests';
  v_failed := false; begin perform save_tutor_draft(st1, sj, 'T', 'Body', array[n1], 'm', 'v1'); exception when sqlstate 'P0002' then v_failed := true; end;
  assert v_failed, '11: school B cannot draft against school A''s class';
  v_failed := false; begin perform review_tutor_draft(d1, 'approve'); exception when sqlstate 'P0002' then v_failed := true; end;
  assert v_failed, '11: school B cannot review school A''s draft';

  -- 12. grants
  execute 'reset role';
  assert not has_function_privilege('anon', 'public.claim_tutor_request(text,text)', 'execute'), '12: anon claim';
  assert not has_function_privilege('anon', 'public.save_tutor_draft(uuid,uuid,text,text,uuid[],text,text)', 'execute'), '12: anon save';
  assert not has_function_privilege('anon', 'public.review_tutor_draft(uuid,text)', 'execute'), '12: anon review';
  assert has_function_privilege('authenticated', 'public.review_tutor_draft(uuid,text)', 'execute'), '12: authenticated review';
  assert not has_function_privilege('authenticated', 'public.tutor_guard()', 'execute'), '12: guard is internal';

  raise notice 'ai tutor behavioural checks: all passed';
end
$$;

rollback;

do $$
begin
  if exists (select 1 from schools where slug in ('tutor-test-a', 'tutor-test-b'))
     or exists (select 1 from auth.users where email like 'tutor-%@example.invalid') then
    raise exception 'LEAK DETECTED: ai tutor test fixtures were not rolled back -- fix this test file before trusting it again';
  end if;
end
$$;
