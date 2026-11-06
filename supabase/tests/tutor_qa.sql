-- Behavioural test for WP 8.2 part 3 (migration *_tutor_qa_core). Rollback-only, synthetic fixtures, real role
-- impersonation (request.jwt.claims). Ends in rollback; a final tripwire fails loudly if any fixture persisted.
--   psql "$SUPABASE_DB_URL" -v ON_ERROR_STOP=1 -f supabase/tests/tutor_qa.sql
begin;

-- Runs a statement as the current role and returns its SQLSTATE ('00000' = succeeded).
create or replace function pg_temp.sqlstate_of(q text) returns text language plpgsql as $$
declare st text;
begin
  execute q;
  return '00000';
exception when others then
  get stacked diagnostics st = returned_sqlstate;
  return st;
end $$;

do $$
declare
  sa uuid := gen_random_uuid(); sb uuid := gen_random_uuid();
  ay uuid := gen_random_uuid(); cl uuid := gen_random_uuid();
  st1 uuid := gen_random_uuid(); st2 uuid := gen_random_uuid();
  sj uuid := gen_random_uuid();
  u_t uuid := gen_random_uuid(); u_dp uuid := gen_random_uuid(); u_own uuid := gen_random_uuid();
  u_p1 uuid := gen_random_uuid(); u_p2 uuid := gen_random_uuid(); u_stu uuid := gen_random_uuid(); u_tb uuid := gen_random_uuid();
  su_t uuid := gen_random_uuid(); su_dp uuid := gen_random_uuid(); su_own uuid := gen_random_uuid();
  su_p1 uuid := gen_random_uuid(); su_p2 uuid := gen_random_uuid(); su_stu uuid := gen_random_uuid(); su_tb uuid := gen_random_uuid();
  ch1 uuid := gen_random_uuid(); ch2 uuid := gen_random_uuid();
  r_teacher uuid; r_dp uuid; r_owner uuid; r_parent uuid; r_student uuid; v_cat uuid;
  f_portal uuid; f_tutor uuid; f_qa uuid;
  note1 uuid := gen_random_uuid(); note2 uuid := gen_random_uuid(); note_other uuid := gen_random_uuid();
  d_ok uuid := gen_random_uuid(); d_draft uuid := gen_random_uuid(); d_other uuid := gen_random_uuid(); d_stale uuid := gen_random_uuid();
  q1 uuid; q1b uuid; q_sg uuid; n integer; ok boolean; s text;
begin
  select id into r_teacher from roles where name = 'teacher';
  select id into r_dp from roles where name = 'deputy_principal';
  select id into r_owner from roles where name = 'school_owner';
  select id into r_parent from roles where name = 'parent';
  select id into r_student from roles where name = 'student';
  select id into v_cat from subject_catalogue limit 1;
  assert r_teacher is not null and r_dp is not null and r_owner is not null and r_parent is not null and r_student is not null and v_cat is not null, 'seed roles/catalogue exist';
  select id into f_portal from platform_feature_flags where key = 'feature.learning.portal';
  select id into f_tutor from platform_feature_flags where key = 'feature.learning.ai_tutor';
  select id into f_qa from platform_feature_flags where key = 'feature.learning.ai_tutor_qa';
  assert f_portal is not null and f_tutor is not null and f_qa is not null, 'flag catalog entries exist';

  insert into schools (id, name, slug, application_number_prefix) values (sa, 'TQA Test A', 'tqa-test-a', 'TQA'), (sb, 'TQA Test B', 'tqa-test-b', 'TQB');
  insert into auth.users (id, aud, role, email) values
    (u_t, 'authenticated', 'authenticated', 'tqa-t@example.invalid'), (u_dp, 'authenticated', 'authenticated', 'tqa-dp@example.invalid'),
    (u_own, 'authenticated', 'authenticated', 'tqa-own@example.invalid'), (u_p1, 'authenticated', 'authenticated', 'tqa-p1@example.invalid'),
    (u_p2, 'authenticated', 'authenticated', 'tqa-p2@example.invalid'), (u_stu, 'authenticated', 'authenticated', 'tqa-stu@example.invalid'),
    (u_tb, 'authenticated', 'authenticated', 'tqa-tb@example.invalid');
  insert into school_users (id, school_id, auth_user_id, role_id, full_name, status) values
    (su_t, sa, u_t, r_teacher, 'TQA Teacher', 'active'), (su_dp, sa, u_dp, r_dp, 'TQA Deputy', 'active'),
    (su_own, sa, u_own, r_owner, 'TQA Owner', 'active'), (su_p1, sa, u_p1, r_parent, 'TQA Parent 1', 'active'),
    (su_p2, sa, u_p2, r_parent, 'TQA Parent 2', 'active'), (su_stu, sa, u_stu, r_student, 'TQA Student', 'active'),
    (su_tb, sb, u_tb, r_teacher, 'TQA Teacher B', 'active');
  insert into academic_years (id, school_id, name, start_date, end_date) values (ay, sa, 'TQA Year', '2026-01-01', '2026-12-31');
  insert into classes (id, school_id, academic_year_id, name, level_order) values (cl, sa, ay, 'TQA Class', 1);
  insert into streams (id, school_id, class_id, name) values (st1, sa, cl, 'North'), (st2, sa, cl, 'South');
  insert into subjects (id, school_id, name, catalogue_id) values (sj, sa, 'TQA Subject', v_cat);
  insert into students (id, school_id, first_name, last_name, date_of_birth, gender, status) values
    (ch1, sa, 'Kid', 'One', date '2012-01-01', 'male', 'approved'), (ch2, sa, 'Kid', 'Two', date '2012-01-02', 'female', 'approved');
  update students set current_class_id = st1, school_user_id = su_stu where id = ch1;
  update students set current_class_id = st2 where id = ch2;
  insert into student_guardians (student_id, guardian_user_id, relationship, primary_contact) values (ch1, su_p1, 'guardian', true), (ch2, su_p2, 'guardian', true);

  -- notes and guides (written directly as the fixture owner; the part 2 functions are covered by ai_tutor.sql)
  insert into learning_resources (id, school_id, stream_id, subject_id, kind, title, body, published) values
    (note1, sa, st1, sj, 'note', 'Fractions', 'A fraction is a part of a whole.', true),
    (note2, sa, st1, sj, 'note', 'Decimals', 'A decimal uses a point.', true),
    (note_other, sa, st2, sj, 'note', 'Other', 'Other stream note.', true);
  insert into tutor_drafts (id, school_id, stream_id, subject_id, title, body, source_resource_ids, source_snapshot, status, prompt_version, reviewed_by, reviewed_at) values
    (d_ok, sa, st1, sj, 'Fractions guide', 'Key ideas...', array[note1], '[]'::jsonb, 'approved', 'tutor-v1', su_t, now()),
    (d_stale, sa, st1, sj, 'Decimals guide', 'Key ideas...', array[note2], '[]'::jsonb, 'approved', 'tutor-v1', su_t, now()),
    (d_draft, sa, st1, sj, 'Unapproved guide', 'Key ideas...', array[note1], '[]'::jsonb, 'draft', 'tutor-v1', null, null),
    (d_other, sa, st2, sj, 'Other stream guide', 'Key ideas...', array[note_other], '[]'::jsonb, 'approved', 'tutor-v1', su_t, now());

  -- 1. flags off: refuses with 55000
  execute 'set local role authenticated';
  perform set_config('request.jwt.claims', json_build_object('sub', u_p1, 'role', 'authenticated')::text, true);
  assert pg_temp.sqlstate_of(format('select tutor_qa_check(%L)', ch1)) = '55000', '1: flags off refuses';
  assert tutor_qa_my_ready() = false, '1: not ready';
  execute 'reset role';

  -- 2. flags on, but the school has not recorded the confirmations: still refuses
  insert into school_feature_flags (school_id, flag_id, enabled) values (sa, f_portal, true), (sa, f_tutor, true), (sa, f_qa, true);
  execute 'set local role authenticated';
  perform set_config('request.jwt.claims', json_build_object('sub', u_p1, 'role', 'authenticated')::text, true);
  assert pg_temp.sqlstate_of(format('select tutor_qa_check(%L)', ch1)) = '55000', '2: flags on without confirmations refuses';
  assert tutor_qa_my_ready() = false, '2: not ready without confirmations';

  -- 3. only the owner or principal may record the confirmations; the contact must be non-parent staff; all three are needed
  assert pg_temp.sqlstate_of(format('select tutor_qa_configure(%L, true, true)', su_dp)) = '42501', '3: a parent may not configure';
  perform set_config('request.jwt.claims', json_build_object('sub', u_t, 'role', 'authenticated')::text, true);
  assert pg_temp.sqlstate_of(format('select tutor_qa_configure(%L, true, true)', su_dp)) = '42501', '3: a teacher may not configure';
  perform set_config('request.jwt.claims', json_build_object('sub', u_tb, 'role', 'authenticated')::text, true);
  assert pg_temp.sqlstate_of(format('select tutor_qa_configure(%L, true, true)', su_dp)) = '42501', '3: other school staff may not configure';
  perform set_config('request.jwt.claims', json_build_object('sub', u_own, 'role', 'authenticated')::text, true);
  assert pg_temp.sqlstate_of(format('select tutor_qa_configure(%L, true, true)', su_p1)) = '22023', '3: a parent cannot be the safeguarding contact';
  assert pg_temp.sqlstate_of(format('select tutor_qa_configure(%L, true, true)', su_tb)) = '22023', '3: other school staff cannot be the contact';
  perform tutor_qa_configure(su_dp, true, false);
  assert tutor_qa_my_ready() = false, '3: parent notice still missing';
  perform tutor_qa_configure(null, true, true);
  assert tutor_qa_my_ready() = false, '3: contact missing';
  perform tutor_qa_configure(su_dp, true, true);
  assert tutor_qa_my_ready() = true, '3: ready when flags and all three confirmations are present';

  -- 4. who may ask for whom
  perform set_config('request.jwt.claims', json_build_object('sub', u_p1, 'role', 'authenticated')::text, true);
  assert tutor_qa_check(ch1) = st1, '4: parent of ch1 gets the stream';
  assert pg_temp.sqlstate_of(format('select tutor_qa_check(%L)', ch2)) = '42501', '4: parent may not ask for another family''s child';
  perform set_config('request.jwt.claims', json_build_object('sub', u_stu, 'role', 'authenticated')::text, true);
  assert tutor_qa_check(ch1) = st1, '4: the learner''s own account works';
  assert pg_temp.sqlstate_of(format('select tutor_qa_check(%L)', ch2)) = '42501', '4: learner may not ask for a classmate';
  perform set_config('request.jwt.claims', json_build_object('sub', u_t, 'role', 'authenticated')::text, true);
  assert pg_temp.sqlstate_of(format('select tutor_qa_check(%L)', ch1)) = '42501', '4: staff cannot ask as a learner';
  perform set_config('request.jwt.claims', json_build_object('sub', u_tb, 'role', 'authenticated')::text, true);
  assert pg_temp.sqlstate_of(format('select tutor_qa_check(%L)', ch1)) = '42501', '4: other school cannot';

  -- 5. saving: answered must cite approved, current guides of the learner's own stream
  perform set_config('request.jwt.claims', json_build_object('sub', u_p1, 'role', 'authenticated')::text, true);
  q1 := save_tutor_qa(ch1, 'key-answered-1', 'What is a fraction?', 'answered', 'A part of a whole.', array[d_ok], 'm', 'qa-v1', 10, 5);
  assert q1 is not null, '5: answered saved';
  q1b := save_tutor_qa(ch1, 'key-answered-1', 'What is a fraction?', 'answered', 'A part of a whole.', array[d_ok], 'm', 'qa-v1', 10, 5);
  assert q1b = q1, '5: same key returns the same row (idempotent)';
  assert pg_temp.sqlstate_of(format('select save_tutor_qa(%L, ''key-bad-1'', ''q'', ''answered'', ''a'', array[%L]::uuid[], null, null, null, null)', ch1, d_other)) = '22023', '5: guide of another class refused';
  assert pg_temp.sqlstate_of(format('select save_tutor_qa(%L, ''key-bad-2'', ''q'', ''answered'', ''a'', array[%L]::uuid[], null, null, null, null)', ch1, d_draft)) = '22023', '5: unapproved guide refused';
  assert pg_temp.sqlstate_of(format('select save_tutor_qa(%L, ''key-bad-3'', ''q'', ''answered'', ''a'', ''{}''::uuid[], null, null, null, null)', ch1)) = '22023', '5: answered without a guide refused';
  assert pg_temp.sqlstate_of(format('select save_tutor_qa(%L, ''key-bad-4'', ''q'', ''not_covered'', ''an answer'', ''{}''::uuid[], null, null, null, null)', ch1)) = '22023', '5: not_covered must carry no answer';
  assert pg_temp.sqlstate_of(format('select save_tutor_qa(%L, ''key-bad-5'', ''q'', ''whatever'', null, ''{}''::uuid[], null, null, null, null)', ch1)) = '22023', '5: unknown status refused';
  assert pg_temp.sqlstate_of(format('select save_tutor_qa(%L, ''key-bad-6'', %L, ''not_covered'', null, ''{}''::uuid[], null, null, null, null)', ch1, repeat('x', 301))) = '22023', '5: over-long question refused';
  assert pg_temp.sqlstate_of(format('select save_tutor_qa(%L, ''key-bad-7'', ''q'', ''not_covered'', null, ''{}''::uuid[], null, null, null, null)', ch2)) = '42501', '5: cannot save for someone else''s child';
  perform save_tutor_qa(ch1, 'key-nc-0001', 'What is the capital of France?', 'not_covered', null, '{}', 'm', 'qa-v1', 10, 5);

  -- 6. a note edited after the guide was written hides the guide: it can no longer be cited
  execute 'reset role';
  update learning_resources set updated_at = now() + interval '1 hour' where id = note2;
  execute 'set local role authenticated';
  perform set_config('request.jwt.claims', json_build_object('sub', u_p1, 'role', 'authenticated')::text, true);
  assert pg_temp.sqlstate_of(format('select save_tutor_qa(%L, ''key-stale-1'', ''q'', ''answered'', ''a'', array[%L]::uuid[], null, null, null, null)', ch1, d_stale)) = '22023', '6: guide with an edited source refused';

  -- 7. the database masks emails and long digit runs even if the app did not
  q_sg := save_tutor_qa(ch1, 'key-mask-001', 'call me on 0712 345 678 or mail a.b@example.com', 'blocked_personal', null, '{}', null, null, null, null);
  execute 'reset role';
  select question into s from tutor_qa_questions where id = q_sg;
  assert s not like '%0712%' and s not like '%345%' and s not like '%@%', '7: stored question is masked: ' || s;
  assert s like '%[number]%' and s like '%[email]%', '7: masks are visible: ' || s;

  -- 8. safeguarding hits are flagged for review; only staff with academics.write or the contact can clear them
  execute 'set local role authenticated';
  perform set_config('request.jwt.claims', json_build_object('sub', u_p1, 'role', 'authenticated')::text, true);
  q_sg := save_tutor_qa(ch1, 'key-safe-001', 'someone is hurting me', 'safeguarding', null, '{}', null, null, null, null);
  assert pg_temp.sqlstate_of(format('select tutor_qa_review(%L)', q_sg)) = '42501', '8: a parent cannot review';
  perform set_config('request.jwt.claims', json_build_object('sub', u_dp, 'role', 'authenticated')::text, true);
  perform tutor_qa_review(q_sg);
  assert pg_temp.sqlstate_of(format('select tutor_qa_review(%L)', q_sg)) = 'P0002', '8: second review changes nothing and says so';
  perform set_config('request.jwt.claims', json_build_object('sub', u_tb, 'role', 'authenticated')::text, true);
  assert pg_temp.sqlstate_of(format('select tutor_qa_review(%L)', q_sg)) in ('42501', '55000'), '8: other school cannot review';
  execute 'reset role';
  select review_status into s from tutor_qa_questions where id = q_sg;
  assert s = 'reviewed', '8: review recorded';

  -- 9. who can read what
  execute 'set local role authenticated';
  perform set_config('request.jwt.claims', json_build_object('sub', u_p1, 'role', 'authenticated')::text, true);
  select count(*) into n from tutor_qa_questions; assert n = 4, '9: parent 1 sees their own 4 questions, got ' || n;
  perform set_config('request.jwt.claims', json_build_object('sub', u_p2, 'role', 'authenticated')::text, true);
  select count(*) into n from tutor_qa_questions; assert n = 0, '9: parent 2 sees none of them';
  perform set_config('request.jwt.claims', json_build_object('sub', u_t, 'role', 'authenticated')::text, true);
  select count(*) into n from tutor_qa_questions; assert n = 4, '9: a teacher of the school sees all of them';
  perform set_config('request.jwt.claims', json_build_object('sub', u_tb, 'role', 'authenticated')::text, true);
  select count(*) into n from tutor_qa_questions; assert n = 0, '9: another school sees none';
  assert pg_temp.sqlstate_of('insert into tutor_qa_questions (school_id) values (gen_random_uuid())') in ('42501', '23502'), '9: no direct inserts';
  execute 'reset role';
  execute 'set local role anon';
  assert pg_temp.sqlstate_of('select count(*) from tutor_qa_questions') in ('00000', '42501'), '9: anon call does not error unexpectedly';
  execute 'reset role';

  -- 10. daily limit, enforced in the database
  update tutor_qa_school_settings set daily_question_limit = 4 where school_id = sa;
  execute 'set local role authenticated';
  perform set_config('request.jwt.claims', json_build_object('sub', u_p1, 'role', 'authenticated')::text, true);
  assert pg_temp.sqlstate_of(format('select tutor_qa_check(%L)', ch1)) = '54000', '10: check refuses at the limit';
  assert pg_temp.sqlstate_of(format('select save_tutor_qa(%L, ''key-limit-01'', ''q'', ''not_covered'', null, ''{}''::uuid[], null, null, null, null)', ch1)) = '54000', '10: save refuses at the limit';
  assert save_tutor_qa(ch1, 'key-answered-1', 'x', 'not_covered', null, '{}', null, null, null, null) = q1, '10: a retry of an old key still returns its row at the limit';
  assert save_tutor_qa(ch1, 'key-limit-sg', 'i want to die', 'safeguarding', null, '{}', null, null, null, null) is not null, '10: a safeguarding hit is recorded even at the limit';
  execute 'reset role';

  -- 11. expiry: hidden at once, deleted lazily on the next save
  update tutor_qa_school_settings set daily_question_limit = 10 where school_id = sa;
  update tutor_qa_questions set expires_at = now() - interval '1 day' where school_id = sa;
  execute 'set local role authenticated';
  perform set_config('request.jwt.claims', json_build_object('sub', u_p1, 'role', 'authenticated')::text, true);
  select count(*) into n from tutor_qa_questions; assert n = 0, '11: expired questions are hidden';
  perform save_tutor_qa(ch1, 'key-after-exp', 'fresh question', 'not_covered', null, '{}', null, null, null, null);
  execute 'reset role';
  select count(*) into n from tutor_qa_questions where school_id = sa; assert n = 1, '11: expired rows were purged on save, got ' || n;
  assert tutor_qa_purge() >= 0, '11: purge runs';

  -- 12. switching a confirmation off, or the flag off, switches the feature off
  execute 'set local role authenticated';
  perform set_config('request.jwt.claims', json_build_object('sub', u_own, 'role', 'authenticated')::text, true);
  perform tutor_qa_configure(su_dp, true, false);
  perform set_config('request.jwt.claims', json_build_object('sub', u_p1, 'role', 'authenticated')::text, true);
  assert tutor_qa_my_ready() = false, '12: clearing the parent notice switches it off';
  assert pg_temp.sqlstate_of(format('select tutor_qa_check(%L)', ch1)) = '55000', '12: and the check refuses';
  execute 'reset role';
  perform set_config('request.jwt.claims', '{}', true);

  -- 13. privileges
  assert not has_function_privilege('anon', 'public.save_tutor_qa(uuid, text, text, text, text, uuid[], text, text, integer, integer)', 'execute'), '13: anon may not save';
  assert not has_function_privilege('anon', 'public.tutor_qa_check(uuid)', 'execute'), '13: anon may not check';
  assert not has_function_privilege('anon', 'public.tutor_qa_configure(uuid, boolean, boolean)', 'execute'), '13: anon may not configure';
  assert not has_function_privilege('authenticated', 'public.tutor_qa_ready(uuid)', 'execute'), '13: authenticated may not call tutor_qa_ready';
  assert not has_function_privilege('authenticated', 'public.tutor_qa_resolve(uuid)', 'execute'), '13: authenticated may not call tutor_qa_resolve';
  assert not has_function_privilege('authenticated', 'public.tutor_qa_purge()', 'execute'), '13: authenticated may not purge';
  assert has_function_privilege('service_role', 'public.tutor_qa_purge()', 'execute'), '13: service_role may purge';
  assert not has_table_privilege('authenticated', 'public.tutor_qa_questions', 'insert'), '13: no direct insert grant';
  assert not has_table_privilege('authenticated', 'public.tutor_qa_questions', 'update'), '13: no direct update grant';
  assert not has_table_privilege('authenticated', 'public.tutor_qa_questions', 'delete'), '13: no direct delete grant';
  assert not exists (select 1 from pg_trigger where tgrelid = 'public.tutor_qa_questions'::regclass and not tgisinternal and tgfoid::regproc::text like '%audit%'), '13: no audit trigger on the questions table (audit_log is append-only)';

  raise notice 'tutor_qa behavioural checks: all passed';
end
$$;

rollback;

do $$
begin
  if exists (select 1 from schools where slug in ('tqa-test-a', 'tqa-test-b')) or exists (select 1 from auth.users where email like 'tqa-%@example.invalid') then
    raise exception 'LEAK DETECTED: tutor_qa test fixtures were not rolled back -- fix this test file before trusting it again';
  end if;
end
$$;
