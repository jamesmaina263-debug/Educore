-- Behavioural test for Phase 1.4 (migrations *_scheduled_fee_reminders and *_fee_reminder_refinements).
-- Rollback-only, synthetic fixtures.
--   psql "$SUPABASE_DB_URL" -v ON_ERROR_STOP=1 -f supabase/tests/scheduled_fee_reminders.sql
-- Needs both migrations deployed. Callers are simulated with request.jwt.claims + role authenticated.
-- NOTE: a passing run ends with the exception MY_TEST_PASSED (so nothing can ever be committed).
begin;

create function pg_temp.fx_student(p_school uuid, p_role uuid, p_first text, p_amount numeric, p_term uuid)
returns uuid language plpgsql as $f$
declare g uuid; s uuid := gen_random_uuid();
begin
  insert into school_users (school_id, role_id, full_name, phone, status)
    values (p_school, p_role, 'Guardian ' || p_first, '+2547' || lpad((floor(random() * 99999999))::text, 8, '0'), 'active') returning id into g;
  insert into students (id, school_id, first_name, last_name, date_of_birth, gender, status)
    values (s, p_school, p_first, 'Fx', date '2012-02-02', 'male', 'approved');
  insert into student_guardians (student_id, guardian_user_id, relationship, primary_contact) values (s, g, 'parent', true);
  update students set status = 'active' where id = s;
  insert into invoices (school_id, student_id, term_id, total_amount) values (p_school, s, p_term, p_amount);
  return s;
end $f$;

do $$
declare
  sa uuid := gen_random_uuid();
  sb uuid := gen_random_uuid();
  u_burs_a uuid := gen_random_uuid();
  u_burs_b uuid := gen_random_uuid();
  u_teacher_a uuid := gen_random_uuid();
  r_burs uuid; r_teacher uuid; v_flag uuid;
  su_g1 uuid; su_g2 uuid; su_g3 uuid;
  ay uuid := gen_random_uuid(); tm uuid := gen_random_uuid();
  st1 uuid := gen_random_uuid(); st2 uuid := gen_random_uuid(); st3 uuid := gen_random_uuid();
  st4 uuid; st5 uuid; st6 uuid; st7 uuid; st8 uuid; st9 uuid;
  v_tpl_bad uuid; v_tpl_cat uuid; v_tpl_ok uuid;
  v_n integer; v_id uuid; v_res text; v_failed boolean; v_cnt integer; v_g uuid; v_log uuid;
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

  -- 2. flag OFF: schedule save refused (55000); generate drafts nothing
  perform set_config('request.jwt.claims', json_build_object('sub', u_burs_a, 'role', 'authenticated')::text, true);
  v_failed := false;
  begin perform set_fee_reminder_schedule(true, 'weekly', 1::smallint, 1::smallint, 'sms', 100, 14::smallint);
  exception when sqlstate '55000' then v_failed := true; end;
  assert v_failed, '2: flag off must refuse the schedule';
  assert generate_fee_reminders(true) = 0, '2: flag off drafts nothing';

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

  -- 4. bursar B (other school, flag off) drafts nothing and sees nothing
  perform set_config('request.jwt.claims', json_build_object('sub', u_burs_b, 'role', 'authenticated')::text, true);
  assert generate_fee_reminders(true) = 0, '4: school B has no schedule/flag';
  assert (select count(*) from fee_reminders) = 0, '4: school B sees no reminders';

  -- 5. bursar A: invalid settings refused; valid schedule saved (default template)
  perform set_config('request.jwt.claims', json_build_object('sub', u_burs_a, 'role', 'authenticated')::text, true);
  v_failed := false;
  begin perform set_fee_reminder_schedule(true, 'daily', 1::smallint, 1::smallint, 'sms', 100, 14::smallint);
  exception when sqlstate '22023' then v_failed := true; end;
  assert v_failed, '5: invalid frequency refused';
  perform set_fee_reminder_schedule(true, 'weekly', 1::smallint, 1::smallint, 'sms', 100, 14::smallint);
  assert (select count(*) from fee_reminder_schedules) = 1, '5: schedule saved, school A only visible';

  -- 6. draft now: st1 drafted; st2 skipped (opted out); st3 skipped (no phone)
  v_n := generate_fee_reminders(true);
  assert v_n = 1, '6: exactly one draft expected, got ' || v_n;
  assert (select count(*) from fee_reminders where status = 'draft' and student_id = st1) = 1, '6: draft is for st1';
  assert (select draft_body from fee_reminders where student_id = st1) like '%5,000%', '6: default body carries the real balance';
  assert (select threshold_at_generation from fee_reminders where student_id = st1) = 100, '6: threshold recorded';
  assert (select count(*) from notification_logs where source_module = 'fee_reminder') = 0, '6: nothing queued by drafting';
  assert generate_fee_reminders(true) = 0, '6: no duplicate drafts';

  -- 7. direct writes change nothing (no write policies)
  v_failed := false;
  begin update fee_reminders set draft_body = 'x'; exception when others then v_failed := true; end;
  assert v_failed or (select count(*) from fee_reminders where draft_body = 'x') = 0, '7: direct update must not change anything';

  -- 8. edit marks the draft edited; send queues exactly one message and links the log
  select id into v_id from fee_reminders where student_id = st1 and status = 'draft';
  perform update_fee_reminder_draft(v_id, 'Custom reminder text');
  assert (select draft_body from fee_reminders where id = v_id) = 'Custom reminder text', '8: edit works';
  assert (select edited from fee_reminders where id = v_id), '8: edited flag set';
  v_res := send_fee_reminder(v_id);
  assert v_res = 'sent', '8: send returns sent, got ' || v_res;
  assert (select status from fee_reminders where id = v_id) = 'sent', '8: status sent';
  assert (select notification_log_id from fee_reminders where id = v_id) is not null, '8: log linked';
  assert (select count(*) from notification_logs where source_module = 'fee_reminder' and recipient_phone = '+254700000001') = 1, '8: exactly one message queued';
  v_failed := false;
  begin perform send_fee_reminder(v_id); exception when sqlstate '55000' then v_failed := true; end;
  assert v_failed, '8: second send refused';

  -- 9. inside the gap, the same guardian + learner + threshold is not drafted again
  assert generate_fee_reminders(true) = 0, '9: inside min_days_between, no new draft';

  -- 10. guardian opts out AFTER the draft was made: send CANCELS, nothing queued
  execute 'reset role';
  delete from notification_preferences where school_user_id = su_g2;
  update fee_reminder_schedules set min_days_between = 1 where school_id = sa;
  update fee_reminders set sent_at = now() - interval '5 days' where student_id = st1 and sent_at is not null;
  execute 'set local role authenticated';
  perform set_config('request.jwt.claims', json_build_object('sub', u_burs_a, 'role', 'authenticated')::text, true);
  assert generate_fee_reminders(true) >= 1, '10: st2 now eligible';
  select id into v_id from fee_reminders where student_id = st2 and status = 'draft';
  assert v_id is not null, '10: st2 draft exists';
  execute 'reset role';
  insert into notification_preferences (school_user_id, category, channel, enabled) values (su_g2, 'fee_reminder', 'sms', false);
  execute 'set local role authenticated';
  perform set_config('request.jwt.claims', json_build_object('sub', u_burs_a, 'role', 'authenticated')::text, true);
  v_cnt := (select count(*) from notification_logs where source_module = 'fee_reminder');
  v_res := send_fee_reminder(v_id);
  assert v_res = 'cancelled', '10: opted-out guardian => cancelled, got ' || v_res;
  assert (select status from fee_reminders where id = v_id) = 'cancelled', '10: status cancelled';
  assert (select cancel_reason from fee_reminders where id = v_id) like '%opted out%', '10: reason recorded';
  assert (select count(*) from notification_logs where source_module = 'fee_reminder') = v_cnt, '10: nothing queued';

  -- 11. dismiss works on a draft and records a reason
  execute 'reset role';
  delete from notification_preferences where school_user_id = su_g2;
  execute 'set local role authenticated';
  perform set_config('request.jwt.claims', json_build_object('sub', u_burs_a, 'role', 'authenticated')::text, true);
  assert generate_fee_reminders(true) >= 1, '11: regenerated a draft for st2';
  select id into v_id from fee_reminders where student_id = st2 and status = 'draft';
  perform dismiss_fee_reminder(v_id, 'Paid in cash');
  assert (select dismiss_reason from fee_reminders where id = v_id) = 'Paid in cash', '11: dismiss reason stored';

  ----------------------------------------------------------------------------------------------
  -- Refinements. Fresh learners, a school template, then each safeguard in turn.
  ----------------------------------------------------------------------------------------------
  execute 'reset role';
  update fee_reminders set status = 'dismissed' where status = 'draft';   -- clean slate
  st4 := pg_temp.fx_student(sa, r_teacher, 'Four', 3000, tm);   -- payment in flight
  st5 := pg_temp.fx_student(sa, r_teacher, 'Five', 3000, tm);   -- paid, awaiting allocation
  st6 := pg_temp.fx_student(sa, r_teacher, 'Six', 3000, tm);    -- amount changes, not edited
  st7 := pg_temp.fx_student(sa, r_teacher, 'Seven', 3000, tm);  -- amount changes, hand-edited
  st8 := pg_temp.fx_student(sa, r_teacher, 'Eight', 3000, tm);  -- failed deliveries
  st9 := pg_temp.fx_student(sa, r_teacher, 'Nine', 3000, tm);   -- recent fee-threshold alert

  insert into communication_templates (school_id, name, channel, category, body)
    values (sa, 'Bad', 'sms', 'fee_reminder', 'Hello {{nope}}') returning id into v_tpl_bad;
  insert into communication_templates (school_id, name, channel, category, body)
    values (sa, 'Wrong category', 'sms', 'announcement', 'Hi {{balance}}') returning id into v_tpl_cat;
  insert into communication_templates (school_id, name, channel, category, body)
    values (sa, 'Good', 'sms', 'fee_reminder', 'Hi {{guardian_name}}: {{student_name}} owes KES {{balance}} at {{school_name}}.') returning id into v_tpl_ok;

  execute 'set local role authenticated';
  perform set_config('request.jwt.claims', json_build_object('sub', u_burs_a, 'role', 'authenticated')::text, true);

  -- 12. template validation: unknown placeholder and wrong category refused; good template saved
  v_failed := false;
  begin perform set_fee_reminder_schedule(true, 'weekly', 1::smallint, 1::smallint, 'sms', 100, 1::smallint, v_tpl_bad);
  exception when sqlstate '22023' then v_failed := true; end;
  assert v_failed, '12: unknown placeholder refused';
  v_failed := false;
  begin perform set_fee_reminder_schedule(true, 'weekly', 1::smallint, 1::smallint, 'sms', 100, 1::smallint, v_tpl_cat);
  exception when sqlstate '22023' then v_failed := true; end;
  assert v_failed, '12: wrong-category template refused';
  perform set_fee_reminder_schedule(true, 'weekly', 1::smallint, 1::smallint, 'sms', 100, 1::smallint, v_tpl_ok);
  assert (select template_id from fee_reminder_schedules) = v_tpl_ok, '12: template saved on the schedule';

  -- 13. drafts use the school template with the real balance
  assert generate_fee_reminders(true) >= 5, '13: drafts created';
  assert (select draft_body from fee_reminders where student_id = st4 and status = 'draft') = 'Hi Guardian Four: Four Fx owes KES 3,000 at Fee Rem A.', '13: template rendered';
  assert (select template_id from fee_reminders where student_id = st4 and status = 'draft') = v_tpl_ok, '13: template linked';

  -- 14. payment in flight (pending) => HOLD, draft kept, nothing queued
  execute 'reset role';
  insert into payments (school_id, student_id, method, amount, status) values (sa, st4, 'mpesa', 3000, 'pending');
  execute 'set local role authenticated';
  perform set_config('request.jwt.claims', json_build_object('sub', u_burs_a, 'role', 'authenticated')::text, true);
  select id into v_id from fee_reminders where student_id = st4 and status = 'draft';
  v_cnt := (select count(*) from notification_logs where source_module = 'fee_reminder');
  v_res := send_fee_reminder(v_id);
  assert v_res = 'hold', '14: payment in flight => hold, got ' || v_res;
  assert (select status from fee_reminders where id = v_id) = 'draft', '14: draft kept';
  assert (select count(*) from notification_logs where source_module = 'fee_reminder') = v_cnt, '14: nothing queued';

  -- 15. money received but not yet allocated => CANCELLED (cleared), not sent
  execute 'reset role';
  insert into payments (school_id, student_id, method, amount, status) values (sa, st5, 'cash', 3000, 'unallocated');
  execute 'set local role authenticated';
  perform set_config('request.jwt.claims', json_build_object('sub', u_burs_a, 'role', 'authenticated')::text, true);
  select id into v_id from fee_reminders where student_id = st5 and status = 'draft';
  v_res := send_fee_reminder(v_id);
  assert v_res = 'cancelled', '15: unallocated payment clears the balance => cancelled, got ' || v_res;
  assert (select cancel_reason from fee_reminders where id = v_id) like '%awaiting allocation%', '15: reason names the unallocated payment';

  -- 16. amount changed (still owing): not sent, draft refreshed to the current figure, needs a fresh approval
  execute 'reset role';
  insert into payments (school_id, student_id, method, amount, status) values (sa, st6, 'cash', 500, 'unallocated');
  execute 'set local role authenticated';
  perform set_config('request.jwt.claims', json_build_object('sub', u_burs_a, 'role', 'authenticated')::text, true);
  select id into v_id from fee_reminders where student_id = st6 and status = 'draft';
  v_cnt := (select count(*) from notification_logs where source_module = 'fee_reminder');
  v_res := send_fee_reminder(v_id);
  assert v_res = 'refreshed', '16: changed amount => refreshed, got ' || v_res;
  assert (select draft_body from fee_reminders where id = v_id) like '%2,500%', '16: draft now shows the current balance';
  assert (select status from fee_reminders where id = v_id) = 'draft', '16: still a draft';
  assert (select count(*) from notification_logs where source_module = 'fee_reminder') = v_cnt, '16: nothing queued yet';
  assert send_fee_reminder(v_id) = 'sent', '16: second approval sends the corrected amount';
  assert (select body from notification_logs where id = (select notification_log_id from fee_reminders where id = v_id)) like '%2,500%', '16: message carries the corrected balance';

  -- 17. amount changed on a HAND-EDITED draft: refused as stale, never silently rewritten; refresh fixes it
  select id into v_id from fee_reminders where student_id = st7 and status = 'draft';
  perform update_fee_reminder_draft(v_id, 'Please pay KES 3,000 by Friday.');
  execute 'reset role';
  insert into payments (school_id, student_id, method, amount, status) values (sa, st7, 'cash', 500, 'unallocated');
  execute 'set local role authenticated';
  perform set_config('request.jwt.claims', json_build_object('sub', u_burs_a, 'role', 'authenticated')::text, true);
  assert send_fee_reminder(v_id) = 'stale', '17: edited draft with a changed amount => stale';
  assert (select draft_body from fee_reminders where id = v_id) = 'Please pay KES 3,000 by Friday.', '17: hand edit untouched';
  assert refresh_fee_reminder(v_id) = 'refreshed', '17: refresh from template';
  assert (select draft_body from fee_reminders where id = v_id) like '%2,500%', '17: refreshed to current balance';
  assert not (select edited from fee_reminders where id = v_id), '17: edited flag reset';
  assert send_fee_reminder(v_id) = 'sent', '17: sends after refresh';

  -- 18. failed deliveries stay eligible, capped at 3 inside the gap
  for i in 1..3 loop
    perform generate_fee_reminders(true);
    select id into v_id from fee_reminders where student_id = st8 and status = 'draft';
    assert v_id is not null, '18: a draft exists on attempt ' || i;
    assert send_fee_reminder(v_id) = 'sent', '18: attempt ' || i || ' sent';
    select notification_log_id into v_log from fee_reminders where id = v_id;
    execute 'reset role';
    update notification_logs set status = 'failed' where id = v_log;
    execute 'set local role authenticated';
    perform set_config('request.jwt.claims', json_build_object('sub', u_burs_a, 'role', 'authenticated')::text, true);
  end loop;
  perform generate_fee_reminders(true);
  assert not exists (select 1 from fee_reminders where student_id = st8 and status = 'draft'), '18: no draft after 3 failed deliveries';
  assert (select count(*) from fee_reminder_delivery_statuses() where delivery_status = 'failed') = 3, '18: delivery states visible to finance';

  -- 19. a recent fee-threshold alert to the same guardian suppresses a reminder; once it FAILED it does not
  execute 'reset role';
  select guardian_user_id into v_g from student_guardians where student_id = st9;
  insert into notification_logs (school_id, student_id, recipient_school_user_id, recipient_phone, recipient_type, channel, body, segments, source_module)
    values (sa, st9, v_g, '+254700000999', 'guardian', 'sms', 'alert', 1, 'fee_threshold_alert') returning id into v_log;
  update fee_reminders set status = 'dismissed' where student_id = st9 and status = 'draft';
  execute 'set local role authenticated';
  perform set_config('request.jwt.claims', json_build_object('sub', u_burs_a, 'role', 'authenticated')::text, true);
  perform generate_fee_reminders(true);
  assert not exists (select 1 from fee_reminders where student_id = st9 and status = 'draft'), '19: suppressed by the recent alert';
  execute 'reset role';
  update notification_logs set status = 'failed' where id = v_log;
  execute 'set local role authenticated';
  perform set_config('request.jwt.claims', json_build_object('sub', u_burs_a, 'role', 'authenticated')::text, true);
  perform generate_fee_reminders(true);
  assert exists (select 1 from fee_reminders where student_id = st9 and status = 'draft'), '19: failed alert no longer suppresses';

  -- 20. a stale draft is withdrawn at the next run once the balance is cleared
  execute 'reset role';
  insert into payments (school_id, student_id, method, amount, status) values (sa, st9, 'cash', 3000, 'unallocated');
  execute 'set local role authenticated';
  perform set_config('request.jwt.claims', json_build_object('sub', u_burs_a, 'role', 'authenticated')::text, true);
  perform generate_fee_reminders(true);
  assert (select status from fee_reminders where student_id = st9 order by generated_at desc limit 1) = 'cancelled', '20: cleared draft cancelled at the next run';

  -- 21. fee-threshold alert preference: accepted category, independent of fee_reminder
  execute 'reset role';
  insert into notification_preferences (school_user_id, category, channel, enabled) values (su_g1, 'fee_threshold_alert', 'sms', false);
  assert notification_allowed(su_g1, 'fee_threshold_alert', 'sms') = false, '21: alerts can be turned off';
  assert notification_allowed(su_g1, 'fee_reminder', 'sms') = true, '21: fee reminders unaffected';
  assert notification_allowed(su_g1, 'announcement', 'sms') = true, '21: other messages unaffected';
  v_failed := false;
  begin insert into notification_preferences (school_user_id, category, channel, enabled) values (su_g1, 'bogus_category', 'sms', false);
  exception when check_violation then v_failed := true; end;
  assert v_failed, '21: unknown categories still rejected';

  -- 22. anon cannot execute any of the functions
  assert not has_function_privilege('anon', 'public.generate_fee_reminders(boolean)', 'execute'), '22: anon generate';
  assert not has_function_privilege('anon', 'public.send_fee_reminder(uuid)', 'execute'), '22: anon send';
  assert not has_function_privilege('anon', 'public.refresh_fee_reminder(uuid)', 'execute'), '22: anon refresh';
  assert not has_function_privilege('anon', 'public.set_fee_reminder_schedule(boolean,text,smallint,smallint,text,numeric,smallint,uuid)', 'execute'), '22: anon set';
  assert not has_function_privilege('anon', 'public.update_fee_reminder_draft(uuid,text)', 'execute'), '22: anon update';
  assert not has_function_privilege('anon', 'public.dismiss_fee_reminder(uuid,text)', 'execute'), '22: anon dismiss';
  assert not has_function_privilege('anon', 'public.fee_reminder_delivery_statuses()', 'execute'), '22: anon delivery';
  assert not has_function_privilege('authenticated', 'public.fee_reminder_outstanding(uuid)', 'execute'), '22: outstanding is internal';

  raise exception 'MY_TEST_PASSED';
end
$$;
rollback;
