-- Behavioural test for the Academic Performance Analytics migrations
--   20261106090000_analytics_settings, 20261106090100_performance_aggregates,
--   20261106090200_student_performance_marks.
-- Rollback-only, synthetic fixtures:
--   psql "$SUPABASE_DB_URL" -v ON_ERROR_STOP=1 -f supabase/tests/performance_analytics.sql
-- Callers are simulated with request.jwt.claims. One transaction ending in `rollback;`.
begin;

do $$
declare
  sa uuid := gen_random_uuid();  sb uuid := gen_random_uuid();
  u_owner uuid := gen_random_uuid(); u_t uuid := gen_random_uuid(); u_tb uuid := gen_random_uuid();
  u_p1 uuid := gen_random_uuid(); u_p2 uuid := gen_random_uuid(); u_stu uuid := gen_random_uuid();
  su_owner uuid := gen_random_uuid(); su_t uuid := gen_random_uuid(); su_tb uuid := gen_random_uuid();
  su_p1 uuid := gen_random_uuid(); su_p2 uuid := gen_random_uuid(); su_stu uuid := gen_random_uuid();
  r_owner uuid; r_teacher uuid; r_parent uuid; r_student uuid; v_cat uuid;
  ay1 uuid := gen_random_uuid(); ay2 uuid := gen_random_uuid();
  t1 uuid := gen_random_uuid();  t2 uuid := gen_random_uuid();
  cl_num uuid := gen_random_uuid(); cl_cbc uuid := gen_random_uuid();
  gs_num uuid := gen_random_uuid(); gs_cbc uuid := gen_random_uuid();
  b_low uuid := gen_random_uuid(); b_high uuid := gen_random_uuid();
  b_a uuid := gen_random_uuid(); b_b uuid := gen_random_uuid(); b_c uuid := gen_random_uuid(); b_d uuid := gen_random_uuid();
  sj uuid := gen_random_uuid();
  ch1 uuid := gen_random_uuid(); ch2 uuid := gen_random_uuid(); ch3 uuid := gen_random_uuid();
  e1 uuid := gen_random_uuid(); e2 uuid := gen_random_uuid(); e3 uuid := gen_random_uuid();
  v_n integer; v_sum numeric; v_row record; v_denied boolean; v_state text; v_s jsonb;
begin
  select id into r_owner from roles where name = 'school_owner';
  select id into r_teacher from roles where name = 'teacher';
  select id into r_parent from roles where name = 'parent';
  select id into r_student from roles where name = 'student';
  select id into v_cat from subject_catalogue limit 1;
  assert r_owner is not null and r_teacher is not null and r_parent is not null and r_student is not null and v_cat is not null, 'seed roles/catalogue exist';

  insert into schools (id, name, slug, application_number_prefix) values
    (sa, 'Perf Test A', 'perf-test-a', 'PTA'), (sb, 'Perf Test B', 'perf-test-b', 'PTB');
  insert into auth.users (id, aud, role, email) values
    (u_owner, 'authenticated', 'authenticated', 'perf-owner@example.invalid'),
    (u_t, 'authenticated', 'authenticated', 'perf-t@example.invalid'),
    (u_tb, 'authenticated', 'authenticated', 'perf-tb@example.invalid'),
    (u_p1, 'authenticated', 'authenticated', 'perf-p1@example.invalid'),
    (u_p2, 'authenticated', 'authenticated', 'perf-p2@example.invalid'),
    (u_stu, 'authenticated', 'authenticated', 'perf-stu@example.invalid');
  insert into school_users (id, school_id, auth_user_id, role_id, full_name, status) values
    (su_owner, sa, u_owner, r_owner, 'Perf Owner', 'active'),
    (su_t, sa, u_t, r_teacher, 'Perf Teacher', 'active'),
    (su_tb, sb, u_tb, r_teacher, 'Perf Teacher B', 'active'),
    (su_p1, sa, u_p1, r_parent, 'Perf Parent 1', 'active'),
    (su_p2, sa, u_p2, r_parent, 'Perf Parent 2', 'active'),
    (su_stu, sa, u_stu, r_student, 'Perf Student', 'active');

  insert into academic_years (id, school_id, name, start_date, end_date) values
    (ay1, sa, 'Perf 2025', '2025-01-01', '2025-12-31'), (ay2, sa, 'Perf 2026', '2026-01-01', '2026-12-31');
  insert into terms (id, school_id, academic_year_id, name, term_number, start_date, end_date) values
    (t1, sa, ay1, 'Perf T1 2025', 1, '2025-01-05', '2025-04-05'), (t2, sa, ay2, 'Perf T2 2026', 2, '2026-05-05', '2026-08-05');

  -- a numeric scale whose derived bands carry points (12) the analytics must IGNORE for numeric marks,
  -- and a CBC scale whose bands have no points
  insert into grading_scales (id, school_id, name, model_type, is_default) values
    (gs_num, sa, 'Perf numeric', 'numeric', true), (gs_cbc, sa, 'Perf cbc', 'cbc', false);
  insert into grading_scale_bands (id, grading_scale_id, label, min_score, max_score, points, level_order) values
    (b_high, gs_num, 'High', 50, 100, 12, 1), (b_low, gs_num, 'Low', 0, 49.99, 5, 2);
  insert into grading_scale_bands (id, grading_scale_id, label, level_order) values
    (b_a, gs_cbc, 'A - Exceeding', 1), (b_b, gs_cbc, 'B - Meeting', 2), (b_c, gs_cbc, 'C - Approaching', 3), (b_d, gs_cbc, 'D - Below', 4);
  update schools set default_grading_scale_id = gs_num where id = sa;

  insert into classes (id, school_id, academic_year_id, name, level_order, grading_scale_id) values
    (cl_num, sa, ay1, 'Perf Numeric Class', 1, gs_num), (cl_cbc, sa, ay1, 'Perf CBC Class', 2, gs_cbc);
  insert into subjects (id, school_id, name, catalogue_id) values (sj, sa, 'Perf Subject', v_cat);
  insert into students (id, school_id, first_name, last_name, date_of_birth, gender, status) values
    (ch1, sa, 'Kid', 'One', date '2012-01-01', 'male', 'approved'),
    (ch2, sa, 'Kid', 'Two', date '2012-01-02', 'female', 'approved'),
    (ch3, sa, 'Kid', 'Three', date '2012-01-03', 'female', 'approved');
  update students set school_user_id = su_stu where id = ch1;
  insert into student_guardians (student_id, guardian_user_id, relationship, primary_contact) values
    (ch1, su_p1, 'guardian', true), (ch2, su_p2, 'guardian', true);

  -- fixtures bypass triggers (lock / band derivation / FK checks); derived band_id is set by hand
  set local session_replication_role = replica;
  insert into exams (id, school_id, term_id, name, exam_type, status) values
    (e1, sa, t1, 'Perf Exam 1', 'exam', 'closed'), (e2, sa, t2, 'Perf Exam 2', 'exam', 'closed'), (e3, sa, t2, 'Perf Open Exam', 'exam', 'open');
  insert into exam_classes (exam_id, class_id) values (e1, cl_num), (e1, cl_cbc), (e2, cl_num), (e3, cl_num);
  insert into exam_subjects (exam_id, class_id, subject_id, max_score) values
    (e1, cl_num, sj, 50), (e1, cl_cbc, sj, 100), (e2, cl_num, sj, 50), (e3, cl_num, sj, 50);
  insert into marks (school_id, exam_id, class_id, subject_id, student_id, raw_score, band_id) values
    (sa, e1, cl_num, sj, ch1, 40, b_high),   -- 80%  (numeric marks also carry a derived band_id)
    (sa, e1, cl_num, sj, ch2, 20, b_low),    -- 40%
    (sa, e2, cl_num, sj, ch1, 45, b_high),   -- 90%
    (sa, e3, cl_num, sj, ch1, 5, b_low),     -- open exam: must never be returned
    (sa, e1, cl_cbc, sj, ch3, null, b_a);    -- CBC level A
  -- only ch1's exam-1 result is released to the family; ch2 and ch3 are not
  insert into report_cards (school_id, exam_id, class_id, student_id, comment_source) values
    (sa, e1, cl_num, ch1, 'teacher_approved');
  set local session_replication_role = origin;

  -- ---- A. scoring rule: every edge case, matching normaliseMarks() in TypeScript ----
  assert public.analytics_mark_score(40, 50, null, null, null, false) = 80, 'A1: percent is raw/max*100';
  assert public.analytics_mark_score(null, null, 2, 4, null, true) = 3, 'A2: level without points, B on 4 levels = 3';
  assert public.analytics_mark_score(null, null, 1, 4, null, true) = 4 and public.analytics_mark_score(null, null, 4, 4, null, true) = 1, 'A3: best=4 worst=1';
  assert public.analytics_mark_score(null, null, 2, 4, 2.5, true) = 2.5, 'A4: scale points win';
  assert public.analytics_mark_score(null, null, 0, 4, null, true) is null and public.analytics_mark_score(null, null, 5, 4, null, true) is null, 'A5: order outside 1..levels dropped';
  assert public.analytics_mark_score(null, null, null, 4, null, true) is null and public.analytics_mark_score(null, null, 2, null, null, true) is null, 'A6: unknown order/levels dropped';
  assert public.analytics_mark_score(null, null, null, null, null, false) is null, 'A7: nothing scorable is null';
  assert public.analytics_mark_score(50, 0, null, null, null, false) is null and public.analytics_mark_score(50, null, null, null, null, false) is null, 'A8: unusable maximum dropped';
  assert public.analytics_mark_score(0, 100, null, null, null, false) = 0, 'A9: a recorded zero is a real zero';
  assert public.analytics_mark_score(45, 50, 1, 2, 12, true) = 90, 'A10: a numeric mark with a derived band is scored by its raw score, never the band points';

  -- ---- B. get_student_performance_marks authorisation (mirrors marks_select) ----
  execute 'set local role authenticated';

  perform set_config('request.jwt.claims', json_build_object('sub', u_p1, 'role', 'authenticated')::text, true);
  select count(*) into v_n from public.get_student_performance_marks(ch1);
  assert v_n = 1, 'B1: guardian sees only the released result for their child, got ' || v_n;
  select * into v_row from public.get_student_performance_marks(ch1);
  assert v_row.raw_score = 40 and v_row.max_score = 50 and v_row.year_name = 'Perf 2025' and v_row.term_number = 1 and v_row.subject_name = 'Perf Subject', 'B2: reference data returned for a family that cannot read terms/years directly';
  select count(*) into v_n from public.get_student_performance_marks(ch2);
  assert v_n = 0, 'B3: guardian cannot read another family''s child';
  select count(*) into v_n from public.academic_years where id = ay1;
  assert v_n = 0, 'B4: the function did not open academic_years to guardians';

  perform set_config('request.jwt.claims', json_build_object('sub', u_p2, 'role', 'authenticated')::text, true);
  select count(*) into v_n from public.get_student_performance_marks(ch1);
  assert v_n = 0, 'B5: another guardian gets nothing for ch1';
  select count(*) into v_n from public.get_student_performance_marks(ch2);
  assert v_n = 0, 'B6: results not yet released to the family are not returned';

  perform set_config('request.jwt.claims', json_build_object('sub', u_stu, 'role', 'authenticated')::text, true);
  select count(*) into v_n from public.get_student_performance_marks(ch1);
  assert v_n = 1, 'B7: the student sees their own released result';
  select count(*) into v_n from public.get_student_performance_marks(ch2);
  assert v_n = 0, 'B8: the student cannot see someone else';

  perform set_config('request.jwt.claims', json_build_object('sub', u_t, 'role', 'authenticated')::text, true);
  select count(*) into v_n from public.get_student_performance_marks(ch1);
  assert v_n = 2, 'B9: staff with exams.read see every CLOSED result across years (open exam excluded), got ' || v_n;
  select count(*) into v_n from public.get_student_performance_marks(ch3);
  assert v_n = 1, 'B10: staff see CBC marks';
  select * into v_row from public.get_student_performance_marks(ch3);
  assert v_row.raw_score is null and v_row.band_label = 'A - Exceeding' and v_row.band_level_order = 1 and v_row.level_count = 4, 'B11: CBC level, order and scale size returned';

  perform set_config('request.jwt.claims', json_build_object('sub', u_tb, 'role', 'authenticated')::text, true);
  select count(*) into v_n from public.get_student_performance_marks(ch1);
  assert v_n = 0, 'B12: staff of another school see nothing';

  execute 'reset role';
  execute 'set local role anon';
  v_denied := false;
  begin perform public.get_student_performance_marks(ch1);
  exception when insufficient_privilege then v_denied := true; end;
  assert v_denied, 'B13: anon cannot execute the function';
  execute 'reset role';

  -- ---- C. aggregates (invoker): correct sums, filters, and no widening of access ----
  execute 'set local role authenticated';
  perform set_config('request.jwt.claims', json_build_object('sub', u_t, 'role', 'authenticated')::text, true);

  select n, score_sum into v_n, v_sum from public.performance_group_aggregates()
    where class_id = cl_num and year_id = ay1 and term_number = 1 and kind = 'percent';
  assert v_n = 2 and v_sum = 120, 'C1: group aggregate ay1/t1 = 2 marks summing 80+40, got ' || coalesce(v_n::text, 'null') || '/' || coalesce(v_sum::text, 'null');
  select n, score_sum into v_n, v_sum from public.performance_group_aggregates()
    where class_id = cl_num and year_id = ay2 and kind = 'percent';
  assert v_n = 1 and v_sum = 90, 'C2: the open exam is excluded from the ay2 aggregate';
  select n, score_sum, level_count into v_row from public.performance_group_aggregates() where class_id = cl_cbc;
  assert v_row.n = 1 and v_row.score_sum = 4 and v_row.level_count = 4, 'C3: CBC level A scores 4 on four levels';
  select count(*) into v_n from public.performance_group_aggregates() where kind = 'percent' and level_count is not null;
  assert v_n = 0, 'C4: a numeric mark carrying a derived band is never aggregated as a level';

  select count(*) into v_n from public.performance_group_aggregates(array[cl_cbc]);
  assert v_n = 1, 'C5: class scope filter';
  select count(*) into v_n from public.performance_student_aggregates(null, null, sj) where student_id = ch1;
  assert v_n = 2, 'C6: student aggregate = one row per year/term (2), got ' || v_n;
  select sum(score_sum) into v_sum from public.performance_student_aggregates(null, null, sj) where student_id = ch1;
  assert v_sum = 170, 'C7: ch1 sums 80 + 90';
  select count(*) into v_n from public.performance_student_aggregates(null, cl_cbc, null);
  assert v_n = 1, 'C8: class filter';

  perform set_config('request.jwt.claims', json_build_object('sub', u_p1, 'role', 'authenticated')::text, true);
  select count(*) into v_n from public.performance_group_aggregates();
  assert v_n = 0, 'C9: invoker rights: a guardian cannot use the aggregates to see more than they can read';
  perform set_config('request.jwt.claims', json_build_object('sub', u_tb, 'role', 'authenticated')::text, true);
  select count(*) into v_n from public.performance_group_aggregates();
  assert v_n = 0, 'C10: another school''s staff see no rows from this school';
  execute 'reset role';

  -- ---- D. update_analytics_settings ----
  execute 'set local role authenticated';
  perform set_config('request.jwt.claims', json_build_object('sub', u_p1, 'role', 'authenticated')::text, true);
  v_denied := false;
  begin perform public.update_analytics_settings('{"intervention_threshold_percent": 60}'::jsonb);
  exception when others then v_denied := true; end;
  assert v_denied, 'D1: a parent cannot change analytics settings';

  perform set_config('request.jwt.claims', json_build_object('sub', u_owner, 'role', 'authenticated')::text, true);
  perform public.update_analytics_settings('{"intervention_threshold_percent": 60}'::jsonb);
  execute 'reset role';
  select analytics_settings into v_s from schools where id = sa;
  assert v_s = '{"intervention_threshold_percent": 60}'::jsonb, 'D2: saved for the caller''s school, got ' || coalesce(v_s::text, 'null');
  assert (select analytics_settings from schools where id = sb) is null, 'D3: other schools untouched';

  execute 'set local role authenticated';
  perform set_config('request.jwt.claims', json_build_object('sub', u_owner, 'role', 'authenticated')::text, true);
  perform public.update_analytics_settings('{"intervention_threshold_level": 2}'::jsonb);
  execute 'reset role';
  select analytics_settings into v_s from schools where id = sa;
  assert v_s = '{"intervention_threshold_percent": 60, "intervention_threshold_level": 2}'::jsonb, 'D4: a partial update merges, got ' || coalesce(v_s::text, 'null');

  execute 'set local role authenticated';
  perform set_config('request.jwt.claims', json_build_object('sub', u_owner, 'role', 'authenticated')::text, true);
  v_denied := false; begin perform public.update_analytics_settings('{"intervention_threshold_percent": 150}'::jsonb); exception when others then v_denied := true; end;
  assert v_denied, 'D5: percent above 100 rejected';
  v_denied := false; begin perform public.update_analytics_settings('{"intervention_threshold_percent": 0}'::jsonb); exception when others then v_denied := true; end;
  assert v_denied, 'D6: percent of 0 rejected';
  v_denied := false; begin perform public.update_analytics_settings('{"intervention_threshold_level": 1}'::jsonb); exception when others then v_denied := true; end;
  assert v_denied, 'D7: level of 1 rejected';
  v_denied := false; begin perform public.update_analytics_settings('{"surprise": 1}'::jsonb); exception when others then v_denied := true; end;
  assert v_denied, 'D8: unknown key rejected';
  v_denied := false; begin perform public.update_analytics_settings('{"intervention_threshold_percent": "60"}'::jsonb); exception when others then v_denied := true; end;
  assert v_denied, 'D9: a string is not a number';
  v_denied := false; begin perform public.update_analytics_settings('[1]'::jsonb); exception when others then v_denied := true; end;
  assert v_denied, 'D10: must be an object';

  perform public.update_analytics_settings('{"intervention_threshold_percent": null}'::jsonb);
  execute 'reset role';
  select analytics_settings into v_s from schools where id = sa;
  assert v_s = '{"intervention_threshold_level": 2}'::jsonb, 'D11: null clears one key back to the default, got ' || coalesce(v_s::text, 'null');

  execute 'set local role authenticated';
  perform set_config('request.jwt.claims', json_build_object('sub', u_owner, 'role', 'authenticated')::text, true);
  perform public.update_analytics_settings('{"intervention_threshold_level": null}'::jsonb);
  execute 'reset role';
  assert (select analytics_settings from schools where id = sa) is null, 'D12: clearing every key returns the column to NULL';

  execute 'set local role anon';
  v_denied := false;
  begin perform public.update_analytics_settings('{"intervention_threshold_percent": 60}'::jsonb);
  exception when insufficient_privilege then v_denied := true; end;
  assert v_denied, 'D13: anon cannot execute update_analytics_settings';
  execute 'reset role';
end;
$$;

rollback;
