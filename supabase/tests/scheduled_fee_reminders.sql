-- Behavioural test for Phase 1.4 (migration *_scheduled_fee_reminders). Rollback-only, synthetic fixtures.
--   psql "$SUPABASE_DB_URL" -v ON_ERROR_STOP=1 -f supabase/tests/scheduled_fee_reminders.sql
-- Needs the migration already deployed. Callers are simulated with request.jwt.claims + role authenticated.
begin;

do $$
declare
  sa uuid := gen_random_uuid();
  sb uuid := gen_random_uuid();
  u_burs_a uuid := gen_random_uuid();
  u_burs_b uuid := gen_random_uuid();
  u_teacher_a uuid := gen_random_uuid();
  r_burs uuid; r_teacher uuid; v_flag uuid;
  su_burs_a uuid; su_g1 uuid; su_g2 uuid; su_g3 uuid;
  ay uuid := gen_random_uuid(); tm uuid := gen_random_uuid();
  st1 uuid := gen_random_uuid(); st2 uuid := gen_random_uuid(); st3 uuid := gen_random_uuid();
  v_n integer; v_id uuid; v_ok boolean; v_failed boolean; v_status text; v_cnt integer;
begin
  select id into r_burs from roles where name = 'bursar';
  select id into r_teacher from roles where name = 'teacher';
  assert r_burs is not null and r_teacher is not null, 'roles exist';

  insert into auth.users (id, aud, role, email) values
    (u_burs_a, 'authenticated', 'authenticated', 'feerem-burs-a@example.invalid'),
    (u_burs_b, 'authenticated', 'authenticated', 'feerem-burs-b@example.invalid'),
    (u_teacher_a, 'authenticated', 'authenticated', 'feerem-teacher-a@example.invalid');
  insert into schools (id, name, slug, application_number_prefix) values
    (sa, 'Fee Rem A', 'fee-rem-a', 'FRA'), (sb, 'Fee Rem B', 'fee-rem-b', 'FRB');
  insert into school_users (auth_user_id, school_id, role_id, full_name, status) values
    (u_burs_a, sa, r_burs, 'Bursar A', 'active'),
    (u_burs_b, sb, r_burs, 'Bursar B', 'active'),
    (u_teacher_a, sa, r_teacher, 'Teacher A', 'active');
  select id into su_burs_a from school_users where auth_user_id = u_burs_a;

  -- guardians (no auth login needed): g1 has a phone, g2 has a phone but will opt out, g3 has no phone
  insert into school_users (school_id, role_id, full_name, phone, status) values (sa, r_teacher, 'Guardian One', '+254700000001', 'active') returning id into su_g1;
  insert into school_users (school_id, role_id, full_name, phone, status) values (sa, r_teacher, 'Guardian Two', '+254700000002', 'active') returning id into su_g2;
  insert into school_users (school_id, role_id, full_name, status) values (sa, r_teacher, 'Guardian Three', 'active') returning id into su_g3;

  insert into academic_years (id, school_id, name, start_date, end_date) values (ay, sa, 'AY', current_date - 100, current_date + 200);
  insert into terms (id, school_id, academic_year_id, name, term_number, start_date, end_date)
    values (tm, sa, ay, 'T1', 1, current_date - 90, current_date + 90);

  insert into students (id, school_id, first_name, last_name, date_of_birth, gender, status) values
    (st1, sa, 'Sam', 'One', date '2012-01-01', 'male', 'approved'),
    (st2, sa, 'Sue', 'Two', date '2012-01-02', 'female', 'approved'),
    (st3, sa, 'Sid', 'Three', date '2012-01-03', 'male', 'approved');
  insert into student_guardians (student_id, guardian_user_id, relationship, primary_contact) values
    (st1, su_g1, 'parent', true), (st2, su_g2, 'parent', true), (st3, su_g3, 'parent', true);
  update students set status = 'active' where id in (st1, st2, st3);
  insert into invoices (school_id, student_id, term_id, total_amount) values
    (sa, st1, tm, 5000), (sa, st2, tm, 6000), (sa, st3, tm, 7000);

  -- g2 opts out of fee reminders on sms
  insert into notification_preferences (school_user_id, category, channel, enabled) values (su_g2, 'fee_reminder', 'sms', false);

  -- 1. no caller refused
  execute 'set local role authenticated';
  perform set_config('request.jwt.claims', '{}', true);
  v_failed := false;
  begin perform generate_fee_reminders(true); exception when others then v_failed := true; end;
  assert v_failed, '1: no caller must be refused';

  -- 2. bursar A, flag OFF: schedule save refused (55000); generate drafts nothing (no schedule/flag)
  perform set_config('request.jwt.claims', json_build_object('sub', u_burs_a, 'role', 'authenticated')::text, true);
  v_failed := false;
  begin perform set_fee_reminder_schedule(true, 'weekly', 1::smallint, 1::smallint, 'sms', 100, 14::smallint);
  exception when sqlstate '55000' then v_failed := true; end;
  assert v_failed, '2: flag off must refuse the schedule';
  assert generate_fee_reminders(true) = 0, '2: flag off drafts nothing';

  -- turn the flag on for school A only (as superuser)
  execute 'reset role';
  select id into v_flag from platform_feature_flags where key = 'feature.finance.scheduled_reminders';
  assert v_flag is not null, 'flag catalog entry exists';
  insert into school_feature_flags (school_id, flag_id, enabled) values (sa, v_flag, true);

  -- 3. teacher (no finance.write) refused
  execute 'set local role authenticated';
  perform set_config('request.jwt.claims', json_build_object('sub', u_teacher_a, 'role', 'authenticated')::text, true);
  v_failed := false;
  begin perform set_fee_reminder_schedule(true, 'weekly', 1::smallint, 1::smallint, 'sms', 100, 14::smallint);
  exception when sqlstate '42501' then v_failed := true; end;
  assert v_failed, '3: teacher must be refused';

  -- 4. bursar B (other school, flag off for B) cannot touch A and drafts nothing
  perform set_config('request.jwt.claims', json_build_object('sub', u_burs_b, 'role', 'authenticated')::text, true);
  assert generate_fee_reminders(true) = 0, '4: school B has no schedule/flag';
  assert (select count(*) from fee_reminders) = 0, '4: school B sees no reminders';

  -- 5. bursar A: invalid settings refused; valid schedule saved
  perform set_config('request.jwt.claims', json_build_object('sub', u_burs_a, 'role', 'authenticated')::text, true);
  v_failed := false;
  begin perform set_fee_reminder_schedule(true, 'daily', 1::smallint, 1::smallint, 'sms', 100, 14::smallint);
  exception when sqlstate '22023' then v_failed := true; end;
  assert v_failed, '5: invalid frequency refused';
  perform set_fee_reminder_schedule(true, 'weekly', 1::smallint, 1::smallint, 'sms', 100, 14::smallint);
  assert (select count(*) from fee_reminder_schedules) = 1, '5: schedule saved, school A only visible';

  -- 6. draft now: st1 (opted in, phone) drafted; st2 skipped (opted out); st3 skipped (no phone)
  v_n := generate_fee_reminders(true);
  assert v_n = 1, '6: exactly one draft expected, got ' || v_n;
  assert (select count(*) from fee_reminders where status = 'draft' and student_id = st1) = 1, '6: draft is for st1';
  assert (select draft_body from fee_reminders where student_id = st1) like '%5,000%', '6: body carries the real balance';
  assert (select count(*) from notification_logs where source_module = 'fee_reminder') = 0, '6: nothing queued by drafting';
  -- re-running does not duplicate
  assert generate_fee_reminders(true) = 0, '6: no duplicate drafts';

  -- 7. direct writes refused (no write policies)
  v_failed := false;
  begin update fee_reminders set draft_body = 'x'; exception when others then v_failed := true; end;
  assert v_failed or (select count(*) from fee_reminders where draft_body = 'x') = 0, '7: direct update must not change anything';

  -- 8. edit draft, then send: queued into notification_logs once; row becomes sent
  select id into v_id from fee_reminders where student_id = st1 and status = 'draft';
  perform update_fee_reminder_draft(v_id, 'Custom reminder text');
  assert (select draft_body from fee_reminders where id = v_id) = 'Custom reminder text', '8: edit works';
  v_ok := send_fee_reminder(v_id);
  assert v_ok, '8: send returns true';
  assert (select status from fee_reminders where id = v_id) = 'sent', '8: status sent';
  assert (select count(*) from notification_logs where source_module = 'fee_reminder' and recipient_phone = '+254700000001') = 1, '8: exactly one message queued';
  v_failed := false;
  begin perform send_fee_reminder(v_id); exception when sqlstate '55000' then v_failed := true; end;
  assert v_failed, '8: second send refused';

  -- 9. min gap: st1 was just reminded, so no new draft even though balance remains
  assert generate_fee_reminders(true) = 0, '9: inside min_days_between, no new draft';

  -- 10. guardian opts out AFTER the draft was made: send auto-dismisses, nothing queued
  execute 'reset role';
  delete from notification_preferences where school_user_id = su_g2;
  update fee_reminders set status = 'dismissed' where student_id = st1;  -- clear st1 from the picture
  update fee_reminder_schedules set min_days_between = 1 where school_id = sa;
  update fee_reminders set sent_at = now() - interval '5 days' where student_id = st1 and sent_at is not null;
  execute 'set local role authenticated';
  perform set_config('request.jwt.claims', json_build_object('sub', u_burs_a, 'role', 'authenticated')::text, true);
  v_n := generate_fee_reminders(true);
  assert v_n >= 1, '10: st2 now eligible, drafted';
  select id into v_id from fee_reminders where student_id = st2 and status = 'draft';
  assert v_id is not null, '10: st2 draft exists';
  execute 'reset role';
  insert into notification_preferences (school_user_id, category, channel, enabled) values (su_g2, 'fee_reminder', 'sms', false);
  execute 'set local role authenticated';
  perform set_config('request.jwt.claims', json_build_object('sub', u_burs_a, 'role', 'authenticated')::text, true);
  v_cnt := (select count(*) from notification_logs where source_module = 'fee_reminder');
  v_ok := send_fee_reminder(v_id);
  assert v_ok = false, '10: opted-out guardian returns false';
  assert (select status from fee_reminders where id = v_id) = 'dismissed', '10: auto-dismissed';
  assert (select count(*) from notification_logs where source_module = 'fee_reminder') = v_cnt, '10: nothing queued';

  -- 11. dismiss works on a draft and records a reason
  execute 'reset role';
  delete from notification_preferences where school_user_id = su_g2;
  execute 'set local role authenticated';
  perform set_config('request.jwt.claims', json_build_object('sub', u_burs_a, 'role', 'authenticated')::text, true);
  -- st2 draft was dismissed in step 10, so regenerate
  assert generate_fee_reminders(true) >= 1, '11: regenerated a draft';
  select id into v_id from fee_reminders where student_id = st2 and status = 'draft';
  perform dismiss_fee_reminder(v_id, 'Paid in cash');
  assert (select dismiss_reason from fee_reminders where id = v_id) = 'Paid in cash', '11: dismiss reason stored';

  -- 12. anon cannot execute any of the functions
  execute 'reset role';
  assert not has_function_privilege('anon', 'public.generate_fee_reminders(boolean)', 'execute'), '12: anon generate';
  assert not has_function_privilege('anon', 'public.send_fee_reminder(uuid)', 'execute'), '12: anon send';
  assert not has_function_privilege('anon', 'public.set_fee_reminder_schedule(boolean,text,smallint,smallint,text,numeric,smallint)', 'execute'), '12: anon set';
  assert not has_function_privilege('anon', 'public.update_fee_reminder_draft(uuid,text)', 'execute'), '12: anon update';
  assert not has_function_privilege('anon', 'public.dismiss_fee_reminder(uuid,text)', 'execute'), '12: anon dismiss';

  raise exception 'MY_TEST_PASSED';
end
$$;
rollback;
