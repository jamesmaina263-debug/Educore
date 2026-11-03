-- Behavioural test for Phase 7.5 (migration *_lesson_plans). Rollback-only, synthetic fixtures.
--   psql "$SUPABASE_DB_URL" -v ON_ERROR_STOP=1 -f supabase/tests/lesson_plans.sql
-- Callers are simulated with request.jwt.claims + role authenticated. One transaction ending in `rollback;`;
-- a final tripwire fails loudly if any fixture row ever persisted.
begin;

do $$
declare
  sa uuid := gen_random_uuid(); sb uuid := gen_random_uuid();
  ay uuid := gen_random_uuid(); tm uuid := gen_random_uuid(); cl uuid := gen_random_uuid(); sj uuid := gen_random_uuid();
  u_ta uuid := gen_random_uuid(); u_ta2 uuid := gen_random_uuid(); u_pr uuid := gen_random_uuid(); u_tb uuid := gen_random_uuid();
  su_ta uuid := gen_random_uuid(); su_ta2 uuid := gen_random_uuid(); su_pr uuid := gen_random_uuid(); su_tb uuid := gen_random_uuid();
  r_teacher uuid; r_principal uuid; v_cat uuid; v_flag uuid;
  sch uuid := gen_random_uuid(); ent uuid := gen_random_uuid();
  v_plan uuid; v_plan2 uuid; v_failed boolean; v_n integer;
begin
  select id into r_teacher from roles where name = 'teacher';
  select id into r_principal from roles where name = 'deputy_principal';
  select id into v_cat from subject_catalogue limit 1;
  assert r_teacher is not null and r_principal is not null and v_cat is not null, 'seed roles/catalogue exist';

  insert into schools (id, name, slug, application_number_prefix) values
    (sa, 'Lesson Plan A', 'lesson-plan-a', 'LPA'), (sb, 'Lesson Plan B', 'lesson-plan-b', 'LPB');
  insert into auth.users (id, aud, role, email) values
    (u_ta, 'authenticated', 'authenticated', 'lessonplan-ta@example.invalid'),
    (u_ta2, 'authenticated', 'authenticated', 'lessonplan-ta2@example.invalid'),
    (u_pr, 'authenticated', 'authenticated', 'lessonplan-pr@example.invalid'),
    (u_tb, 'authenticated', 'authenticated', 'lessonplan-tb@example.invalid');
  insert into school_users (id, school_id, auth_user_id, role_id, full_name, status) values
    (su_ta, sa, u_ta, r_teacher, 'LP Teacher A', 'active'),
    (su_ta2, sa, u_ta2, r_teacher, 'LP Teacher A2', 'active'),
    (su_pr, sa, u_pr, r_principal, 'LP Principal A', 'active'),
    (su_tb, sb, u_tb, r_teacher, 'LP Teacher B', 'active');
  insert into academic_years (id, school_id, name, start_date, end_date) values (ay, sa, 'LP Year', '2026-01-01', '2026-12-31');
  insert into terms (id, school_id, academic_year_id, name, term_number, start_date, end_date) values (tm, sa, ay, 'LP Term', 1, '2026-01-01', '2026-04-01');
  insert into classes (id, school_id, academic_year_id, name, level_order) values (cl, sa, ay, 'LP Class', 1);
  insert into subjects (id, school_id, name, catalogue_id) values (sj, sa, 'LP Subject', v_cat);
  insert into schemes_of_work (id, school_id, academic_year_id, term_id, class_id, subject_id, teacher_id, total_weeks, lessons_per_week)
    values (sch, sa, ay, tm, cl, sj, su_ta, 3, 2);
  insert into scheme_of_work_entries (id, scheme_id, week_number, lesson_number, topic, learning_outcomes, content, activities, resources, assessment_methods)
    values (ent, sch, 1, 1, 'Fractions', 'Add simple fractions', 'Like denominators', 'Pair work', 'Charts', 'Oral questions');

  -- 1. flag OFF: owner teacher cannot create (55000) nor insert directly
  execute 'set local role authenticated';
  perform set_config('request.jwt.claims', json_build_object('sub', u_ta, 'role', 'authenticated')::text, true);
  v_failed := false;
  begin perform create_lesson_plan_from_entry(ent); exception when sqlstate '55000' then v_failed := true; end;
  assert v_failed, '1: flag off must refuse create';
  v_failed := false;
  begin insert into lesson_plans (school_id, teacher_id, scheme_entry_id) values (sa, su_ta, ent); exception when others then v_failed := true; end;
  assert v_failed, '1: flag off must refuse direct insert';

  execute 'reset role';
  select id into v_flag from platform_feature_flags where key = 'feature.academics.lesson_plans';
  assert v_flag is not null, 'flag catalog entry exists';
  insert into school_feature_flags (school_id, flag_id, enabled) values (sa, v_flag, true);

  -- 2. owner teacher creates, prefilled; second call is idempotent
  execute 'set local role authenticated';
  perform set_config('request.jwt.claims', json_build_object('sub', u_ta, 'role', 'authenticated')::text, true);
  v_plan := create_lesson_plan_from_entry(ent);
  assert v_plan is not null, '2: plan created';
  assert (select objectives from lesson_plans where id = v_plan) = 'Add simple fractions', '2: objectives prefilled';
  assert (select development from lesson_plans where id = v_plan) like 'Like denominators%Pair work', '2: development prefilled from content + activities';
  assert (select teacher_id from lesson_plans where id = v_plan) = su_ta and (select school_id from lesson_plans where id = v_plan) = sa, '2: bound to scheme owner and school';
  v_plan2 := create_lesson_plan_from_entry(ent);
  assert v_plan2 = v_plan, '2: idempotent';
  assert (select count(*) from lesson_plans) = 1, '2: exactly one plan';

  -- 3. edit; taught needs a date
  update lesson_plans set introduction = 'Recap', duration_minutes = 40 where id = v_plan;
  assert (select introduction from lesson_plans where id = v_plan) = 'Recap', '3: edit works';
  v_failed := false;
  begin update lesson_plans set status = 'taught' where id = v_plan; exception when check_violation then v_failed := true; end;
  assert v_failed, '3: taught without a date refused';
  v_failed := false;
  begin update lesson_plans set duration_minutes = 1 where id = v_plan; exception when check_violation then v_failed := true; end;
  assert v_failed, '3: silly duration refused';
  update lesson_plans set status = 'taught', taught_on = current_date where id = v_plan;
  assert (select status from lesson_plans where id = v_plan) = 'taught', '3: taught with a date ok';

  -- 4. spoofing: school/teacher cannot be changed, plan cannot move to another lesson
  update lesson_plans set school_id = sb, teacher_id = su_tb where id = v_plan;
  assert (select school_id from lesson_plans where id = v_plan) = sa and (select teacher_id from lesson_plans where id = v_plan) = su_ta, '4: school/teacher re-bound by trigger';

  -- 5. another teacher, same school: can read, cannot edit, cannot create for someone elses lesson
  perform set_config('request.jwt.claims', json_build_object('sub', u_ta2, 'role', 'authenticated')::text, true);
  assert (select count(*) from lesson_plans where id = v_plan) = 1, '5: same-school teacher can read';
  update lesson_plans set introduction = 'Hijack' where id = v_plan;
  get diagnostics v_n = row_count;
  assert v_n = 0, '5: non-owner teacher cannot edit';
  execute 'reset role';
  delete from lesson_plans where id = v_plan;
  execute 'set local role authenticated';
  perform set_config('request.jwt.claims', json_build_object('sub', u_ta2, 'role', 'authenticated')::text, true);
  v_failed := false;
  begin perform create_lesson_plan_from_entry(ent); exception when others then v_failed := true; end;
  assert v_failed, '5: non-owner teacher cannot create a plan for another teachers lesson';
  assert (select count(*) from lesson_plans) = 0, '5: nothing created';
  execute 'reset role';
  insert into lesson_plans (school_id, teacher_id, scheme_entry_id, objectives) values (sa, su_ta, ent, 'Add simple fractions') returning id into v_plan;

  -- 6. principal (write_any) can read and edit
  execute 'set local role authenticated';
  perform set_config('request.jwt.claims', json_build_object('sub', u_pr, 'role', 'authenticated')::text, true);
  update lesson_plans set reflection = 'Reviewed' where id = v_plan;
  assert (select reflection from lesson_plans where id = v_plan) = 'Reviewed', '6: write_any can edit';

  -- 7. other school (flag on there too) sees nothing and cannot create for school As lesson
  execute 'reset role';
  insert into school_feature_flags (school_id, flag_id, enabled) values (sb, v_flag, true);
  execute 'set local role authenticated';
  perform set_config('request.jwt.claims', json_build_object('sub', u_tb, 'role', 'authenticated')::text, true);
  assert (select count(*) from lesson_plans) = 0, '7: school B sees no plans of A';
  v_failed := false;
  begin perform create_lesson_plan_from_entry(ent); exception when sqlstate '22023' then v_failed := true; end;
  assert v_failed, '7: school B cannot even see As scheme entry';
  update lesson_plans set reflection = 'x' where id = v_plan;
  get diagnostics v_n = row_count;
  assert v_n = 0, '7: school B cannot edit';

  -- 8. anon cannot execute
  execute 'reset role';
  assert not has_function_privilege('anon', 'public.create_lesson_plan_from_entry(uuid)', 'execute'), '8: anon create';
  assert has_function_privilege('authenticated', 'public.create_lesson_plan_from_entry(uuid)', 'execute'), '8: authenticated create';
  assert not has_function_privilege('authenticated', 'public.lesson_plans_bind_scheme()', 'execute'), '8: trigger fn internal';

  raise notice 'lesson plans behavioural checks: all passed';
end
$$;

rollback;

do $$
begin
  if exists (select 1 from schools where slug in ('lesson-plan-a', 'lesson-plan-b'))
     or exists (select 1 from auth.users where email like 'lessonplan-%@example.invalid') then
    raise exception 'LEAK DETECTED: lesson-plan test fixtures were not rolled back -- fix this test file before trusting it again';
  end if;
end
$$;
