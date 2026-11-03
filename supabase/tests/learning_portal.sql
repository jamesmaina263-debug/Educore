-- Behavioural test for Phase 8.1 (migration *_learning_portal_lite). Rollback-only, synthetic fixtures,
-- real role impersonation (request.jwt.claims). One transaction ending in `rollback;`; a final tripwire
-- fails loudly if any fixture row persisted.
--   psql "$SUPABASE_DB_URL" -v ON_ERROR_STOP=1 -f supabase/tests/learning_portal.sql
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
  r_teacher uuid; r_dp uuid; r_parent uuid; r_student uuid; v_cat uuid; v_flag uuid;
  v_note uuid; v_vid uuid; v_pp uuid; v_live uuid; v_quiz uuid; v_quiz2 uuid; v_res jsonb;
  v_n integer; v_failed boolean; v_state text;
  q3 jsonb := '[
    {"prompt":"2+2?","options":["4","5","6"],"correct_index":0,"marks":1},
    {"prompt":"Capital of Kenya?","options":["Mombasa","Nairobi","Kisumu"],"correct_index":1,"marks":2},
    {"prompt":"Largest planet?","options":["Earth","Mars","Jupiter"],"correct_index":2}
  ]'::jsonb;
begin
  select id into r_teacher from roles where name = 'teacher';
  select id into r_dp from roles where name = 'deputy_principal';
  select id into r_parent from roles where name = 'parent';
  select id into r_student from roles where name = 'student';
  select id into v_cat from subject_catalogue limit 1;
  assert r_teacher is not null and r_dp is not null and r_parent is not null and r_student is not null and v_cat is not null, 'seed roles/catalogue exist';

  insert into schools (id, name, slug, application_number_prefix) values
    (sa, 'Learn Test A', 'learn-test-a', 'LTA'), (sb, 'Learn Test B', 'learn-test-b', 'LTB');
  insert into auth.users (id, aud, role, email) values
    (u_t1, 'authenticated', 'authenticated', 'learn-t1@example.invalid'),
    (u_t2, 'authenticated', 'authenticated', 'learn-t2@example.invalid'),
    (u_dp, 'authenticated', 'authenticated', 'learn-dp@example.invalid'),
    (u_p1, 'authenticated', 'authenticated', 'learn-p1@example.invalid'),
    (u_p2, 'authenticated', 'authenticated', 'learn-p2@example.invalid'),
    (u_stu, 'authenticated', 'authenticated', 'learn-stu@example.invalid'),
    (u_tb, 'authenticated', 'authenticated', 'learn-tb@example.invalid');
  insert into school_users (id, school_id, auth_user_id, role_id, full_name, status) values
    (su_t1, sa, u_t1, r_teacher, 'Learn Teacher 1', 'active'),
    (su_t2, sa, u_t2, r_teacher, 'Learn Teacher 2', 'active'),
    (su_dp, sa, u_dp, r_dp, 'Learn Deputy', 'active'),
    (su_p1, sa, u_p1, r_parent, 'Learn Parent 1', 'active'),
    (su_p2, sa, u_p2, r_parent, 'Learn Parent 2', 'active'),
    (su_stu, sa, u_stu, r_student, 'Learn Student', 'active'),
    (su_tb, sb, u_tb, r_teacher, 'Learn Teacher B', 'active');
  insert into academic_years (id, school_id, name, start_date, end_date) values (ay, sa, 'Learn Year', '2026-01-01', '2026-12-31');
  insert into classes (id, school_id, academic_year_id, name, level_order) values (cl, sa, ay, 'Learn Class', 1);
  insert into streams (id, school_id, class_id, name) values (st1, sa, cl, 'North'), (st2, sa, cl, 'South');
  insert into subjects (id, school_id, name, catalogue_id) values (sj, sa, 'Learn Subject', v_cat);
  insert into students (id, school_id, first_name, last_name, date_of_birth, gender, status) values
    (ch1, sa, 'Kid', 'One', date '2012-01-01', 'male', 'approved'),
    (ch2, sa, 'Kid', 'Two', date '2012-01-02', 'female', 'approved');
  update students set current_class_id = st1, school_user_id = su_stu where id = ch1;
  update students set current_class_id = st2 where id = ch2;
  insert into student_guardians (student_id, guardian_user_id, relationship, primary_contact) values
    (ch1, su_p1, 'guardian', true), (ch2, su_p2, 'guardian', true);

  -- 1. flag OFF: nothing works
  execute 'set local role authenticated';
  perform set_config('request.jwt.claims', json_build_object('sub', u_t1, 'role', 'authenticated')::text, true);
  v_failed := false;
  begin perform save_learning_resource(null, st1, sj, 'note', 'Notes', 'Body', null, null, null, true);
  exception when others then get stacked diagnostics v_state = returned_sqlstate; v_failed := (v_state = '55000'); end;
  assert v_failed, '1: flag off refuses save with 55000';
  execute 'reset role';
  select id into v_flag from platform_feature_flags where key = 'feature.learning.portal';
  assert v_flag is not null, 'flag catalog entry exists';
  insert into school_feature_flags (school_id, flag_id, enabled) values (sa, v_flag, true);

  -- 2. teacher creates resources; shape rules are enforced
  execute 'set local role authenticated';
  perform set_config('request.jwt.claims', json_build_object('sub', u_t1, 'role', 'authenticated')::text, true);
  v_note := save_learning_resource(null, st1, sj, 'note', 'Fractions notes', 'A fraction is...', null, null, null, false);
  v_vid := save_learning_resource(null, st1, sj, 'video', 'Fractions video', null, 'https://example.invalid/v/1', null, null, true);
  v_pp := save_learning_resource(null, st1, sj, 'past_paper', 'KCPE 2019', null, 'https://example.invalid/p/2019', null, 2019, true);
  v_live := save_learning_resource(null, st1, sj, 'live_lesson', 'Revision live', null, 'https://example.invalid/meet/abc', now() + interval '1 day', null, true);
  v_failed := false;
  begin perform save_learning_resource(null, st1, sj, 'video', 'Bad http', null, 'http://example.invalid/v', null, null, true);
  exception when sqlstate '22023' then v_failed := true; end;
  assert v_failed, '2: http link refused';
  v_failed := false;
  begin perform save_learning_resource(null, st1, sj, 'video', 'Bad js', null, 'javascript:alert(1)', null, null, true);
  exception when sqlstate '22023' then v_failed := true; end;
  assert v_failed, '2: javascript link refused';
  v_failed := false;
  begin perform save_learning_resource(null, st1, sj, 'note', 'Note with link', 'x', 'https://example.invalid', null, null, true);
  exception when sqlstate '22023' then v_failed := true; end;
  assert v_failed, '2: note with a link refused';
  v_failed := false;
  begin perform save_learning_resource(null, st1, sj, 'live_lesson', 'No time', null, 'https://example.invalid/m', null, null, true);
  exception when sqlstate '22023' then v_failed := true; end;
  assert v_failed, '2: live lesson needs a start time';
  v_failed := false;
  begin perform save_learning_resource(null, stb, sj, 'note', 'Wrong stream', 'x', null, null, null, true);
  exception when sqlstate 'P0002' then v_failed := true; end;
  assert v_failed, '2: stream from nowhere refused';

  -- 3. visibility
  select count(*) into v_n from learning_resources;
  assert v_n = 4, '3: staff see the draft and the published ones';
  execute 'reset role';
  execute 'set local role authenticated';
  perform set_config('request.jwt.claims', json_build_object('sub', u_p1, 'role', 'authenticated')::text, true);
  select count(*) into v_n from learning_resources;
  assert v_n = 3, '3: guardian sees the 3 published, not the draft note';
  assert not exists (select 1 from learning_resources where id = v_note), '3: draft hidden from guardian';
  perform set_config('request.jwt.claims', json_build_object('sub', u_p2, 'role', 'authenticated')::text, true);
  select count(*) into v_n from learning_resources;
  assert v_n = 0, '3: guardian of a child in another stream sees nothing';
  perform set_config('request.jwt.claims', json_build_object('sub', u_stu, 'role', 'authenticated')::text, true);
  select count(*) into v_n from learning_resources;
  assert v_n = 3, '3: student sees published material for their own stream';
  perform set_config('request.jwt.claims', json_build_object('sub', u_tb, 'role', 'authenticated')::text, true);
  select count(*) into v_n from learning_resources;
  assert v_n = 0, '3: other school sees nothing';

  -- 4. ownership
  perform set_config('request.jwt.claims', json_build_object('sub', u_t2, 'role', 'authenticated')::text, true);
  v_failed := false;
  begin perform save_learning_resource(v_vid, st1, sj, 'video', 'Hijacked', null, 'https://example.invalid/v/1', null, null, true);
  exception when sqlstate '42501' then v_failed := true; end;
  assert v_failed, '4: another teacher cannot edit';
  v_failed := false;
  begin perform delete_learning_resource(v_vid);
  exception when sqlstate '42501' then v_failed := true; end;
  assert v_failed, '4: another teacher cannot delete';
  perform set_config('request.jwt.claims', json_build_object('sub', u_t1, 'role', 'authenticated')::text, true);
  perform save_learning_resource(v_note, st1, sj, 'note', 'Fractions notes', 'A fraction is...', null, null, null, true);
  perform set_config('request.jwt.claims', json_build_object('sub', u_p1, 'role', 'authenticated')::text, true);
  assert exists (select 1 from learning_resources where id = v_note), '4: publishing makes it visible';
  perform set_config('request.jwt.claims', json_build_object('sub', u_dp, 'role', 'authenticated')::text, true);
  perform save_learning_resource(v_vid, st1, sj, 'video', 'Fractions video (edited)', null, 'https://example.invalid/v/1', null, null, true);
  perform delete_learning_resource(v_live);
  assert not exists (select 1 from learning_resources where id = v_live), '4: academics.write can delete anyone''s';

  -- 5. direct writes are blocked
  perform set_config('request.jwt.claims', json_build_object('sub', u_t1, 'role', 'authenticated')::text, true);
  v_failed := false;
  begin insert into learning_resources (school_id, stream_id, subject_id, kind, title, body) values (sa, st1, sj, 'note', 'Sneaky', 'x');
  exception when others then get stacked diagnostics v_state = returned_sqlstate; v_failed := (v_state = '42501'); end;
  assert v_failed, '5: direct insert blocked';
  update learning_resources set title = 'tampered' where id = v_vid;
  get diagnostics v_n = row_count;
  assert v_n = 0, '5: direct update changes nothing';
  delete from learning_resources where id = v_vid;
  get diagnostics v_n = row_count;
  assert v_n = 0, '5: direct delete changes nothing';

  -- 6. quiz creation and validation
  v_quiz := save_learning_quiz(null, st1, sj, 'Week 1 quiz', 'Quick check', 1, false, 'draft', q3);
  assert (select count(*) from learning_quiz_questions where quiz_id = v_quiz) = 3, '6: three questions saved';
  v_failed := false;
  begin perform save_learning_quiz(null, st1, sj, 'Bad index', null, 1, false, 'draft', '[{"prompt":"q","options":["a","b"],"correct_index":2}]'::jsonb);
  exception when sqlstate '22023' then v_failed := true; end;
  assert v_failed, '6: correct index out of range refused';
  v_failed := false;
  begin perform save_learning_quiz(null, st1, sj, 'One option', null, 1, false, 'draft', '[{"prompt":"q","options":["a"],"correct_index":0}]'::jsonb);
  exception when sqlstate '22023' then v_failed := true; end;
  assert v_failed, '6: a single option refused';
  v_failed := false;
  begin perform save_learning_quiz(null, st1, sj, 'Big marks', null, 1, false, 'draft', '[{"prompt":"q","options":["a","b"],"correct_index":0,"marks":11}]'::jsonb);
  exception when sqlstate '22023' then v_failed := true; end;
  assert v_failed, '6: marks over 10 refused';
  v_failed := false;
  begin perform save_learning_quiz(null, st1, sj, 'No questions', null, 1, false, 'draft', null);
  exception when sqlstate '22023' then v_failed := true; end;
  assert v_failed, '6: a new quiz needs questions';

  -- 7. learners cannot see the draft, and can never see the key
  perform set_config('request.jwt.claims', json_build_object('sub', u_p1, 'role', 'authenticated')::text, true);
  select count(*) into v_n from learning_quizzes;
  assert v_n = 0, '7: draft quiz hidden from guardian';
  perform set_config('request.jwt.claims', json_build_object('sub', u_t1, 'role', 'authenticated')::text, true);
  v_quiz := save_learning_quiz(v_quiz, st1, sj, 'Week 1 quiz', 'Quick check', 1, false, 'published', null);
  v_quiz2 := save_learning_quiz(null, st1, sj, 'Week 2 quiz', null, 2, true, 'published', q3);
  select count(*) into v_n from learning_quiz_keys;
  assert v_n = 6, '7: teacher can read the keys';
  perform set_config('request.jwt.claims', json_build_object('sub', u_p1, 'role', 'authenticated')::text, true);
  select count(*) into v_n from learning_quizzes;
  assert v_n = 2, '7: guardian sees the published quizzes';
  select count(*) into v_n from learning_quiz_questions;
  assert v_n = 6, '7: guardian sees the questions';
  select count(*) into v_n from learning_quiz_keys;
  assert v_n = 0, '7: guardian can never read the key';
  perform set_config('request.jwt.claims', json_build_object('sub', u_stu, 'role', 'authenticated')::text, true);
  select count(*) into v_n from learning_quiz_keys;
  assert v_n = 0, '7: student can never read the key';

  -- 8. marking
  perform set_config('request.jwt.claims', json_build_object('sub', u_p1, 'role', 'authenticated')::text, true);
  v_res := submit_learning_quiz(v_quiz, ch1, '[0,1,null]'::jsonb);
  assert (v_res ->> 'score')::int = 3 and (v_res ->> 'total')::int = 4, '8: marked 3 out of 4';
  assert (v_res ->> 'attempts_left')::int = 0 and (v_res -> 'review') = 'null'::jsonb, '8: no review when answers are hidden';
  v_failed := false;
  begin perform submit_learning_quiz(v_quiz, ch1, '[0,1,2]'::jsonb);
  exception when sqlstate '22023' then v_failed := true; end;
  assert v_failed, '8: second attempt refused at the limit';
  v_failed := false;
  begin perform submit_learning_quiz(v_quiz2, ch1, '[0,1]'::jsonb);
  exception when sqlstate '22023' then v_failed := true; end;
  assert v_failed, '8: wrong number of answers refused';
  v_failed := false;
  begin perform submit_learning_quiz(v_quiz2, ch1, '[0,1,9]'::jsonb);
  exception when sqlstate '22023' then v_failed := true; end;
  assert v_failed, '8: answer outside the options refused';
  v_failed := false;
  begin perform submit_learning_quiz(v_quiz2, ch2, '[0,1,2]'::jsonb);
  exception when sqlstate '42501' then v_failed := true; end;
  assert v_failed, '8: guardian cannot submit for someone else''s child';
  perform set_config('request.jwt.claims', json_build_object('sub', u_stu, 'role', 'authenticated')::text, true);
  v_res := submit_learning_quiz(v_quiz2, ch1, '[0,0,2]'::jsonb);
  assert (v_res ->> 'score')::int = 2 and (v_res ->> 'attempts_left')::int = 1, '8: student marks own attempt, one left';
  assert jsonb_array_length(v_res -> 'review') = 3 and (v_res -> 'review' -> 1 ->> 'correct_index')::int = 1, '8: review shows the key when allowed';
  perform set_config('request.jwt.claims', json_build_object('sub', u_p2, 'role', 'authenticated')::text, true);
  v_failed := false;
  begin perform submit_learning_quiz(v_quiz2, ch2, '[0,1,2]'::jsonb);
  exception when sqlstate '42501' then v_failed := true; end;
  assert v_failed, '8: child in another stream cannot take this quiz';

  -- 9. attempts visibility and no direct writes
  perform set_config('request.jwt.claims', json_build_object('sub', u_p1, 'role', 'authenticated')::text, true);
  select count(*) into v_n from learning_quiz_attempts;
  assert v_n = 2, '9: guardian sees own child''s attempts (including the one the student made)';
  perform set_config('request.jwt.claims', json_build_object('sub', u_p2, 'role', 'authenticated')::text, true);
  select count(*) into v_n from learning_quiz_attempts;
  assert v_n = 0, '9: other guardian sees none';
  perform set_config('request.jwt.claims', json_build_object('sub', u_t1, 'role', 'authenticated')::text, true);
  select count(*) into v_n from learning_quiz_attempts;
  assert v_n = 2, '9: staff see attempts';
  v_failed := false;
  begin insert into learning_quiz_attempts (school_id, quiz_id, student_id, attempt_no, answers, score, total) values (sa, v_quiz, ch1, 5, '[]'::jsonb, 99, 99);
  exception when others then get stacked diagnostics v_state = returned_sqlstate; v_failed := (v_state = '42501'); end;
  assert v_failed, '9: direct attempt insert blocked';

  -- 10. questions freeze once attempts exist; closing still works; closed quizzes take no more attempts
  v_failed := false;
  begin perform save_learning_quiz(v_quiz, st1, sj, 'Week 1 quiz', null, 1, false, 'published', q3);
  exception when sqlstate '22023' then v_failed := true; end;
  assert v_failed, '10: questions cannot be replaced after attempts';
  perform save_learning_quiz(v_quiz2, st1, sj, 'Week 2 quiz (closed)', null, 2, true, 'closed', null);
  assert (select status from learning_quizzes where id = v_quiz2) = 'closed', '10: quiz closed';
  perform set_config('request.jwt.claims', json_build_object('sub', u_stu, 'role', 'authenticated')::text, true);
  v_failed := false;
  begin perform submit_learning_quiz(v_quiz2, ch1, '[0,1,2]'::jsonb);
  exception when sqlstate 'P0002' then v_failed := true; end;
  assert v_failed, '10: closed quiz takes no attempts';

  -- 11. other school
  perform set_config('request.jwt.claims', json_build_object('sub', u_tb, 'role', 'authenticated')::text, true);
  select count(*) into v_n from learning_quizzes;
  assert v_n = 0, '11: other school sees no quizzes';
  execute 'reset role';

  -- 12. audit and grants
  assert exists (select 1 from audit_log where table_name = 'learning_quizzes' and record_id = v_quiz and school_id = sa), '12: quiz changes audited';
  assert not has_function_privilege('anon', 'public.save_learning_resource(uuid,uuid,uuid,text,text,text,text,timestamptz,integer,boolean)', 'execute'), '12: anon save resource';
  assert not has_function_privilege('anon', 'public.save_learning_quiz(uuid,uuid,uuid,text,text,integer,boolean,text,jsonb)', 'execute'), '12: anon save quiz';
  assert not has_function_privilege('anon', 'public.submit_learning_quiz(uuid,uuid,jsonb)', 'execute'), '12: anon submit';
  assert not has_function_privilege('authenticated', 'public.learning_guard()', 'execute'), '12: guard is internal';

  raise notice 'learning portal behavioural checks: all passed';
end
$$;

rollback;

do $$
begin
  if exists (select 1 from schools where slug in ('learn-test-a', 'learn-test-b'))
     or exists (select 1 from auth.users where email like 'learn-%@example.invalid') then
    raise exception 'LEAK DETECTED: learning portal test fixtures were not rolled back -- fix this test file before trusting it again';
  end if;
end
$$;
