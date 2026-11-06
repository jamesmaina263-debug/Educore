-- Behavioural test for WP 4.5 (migration *_wp_4_5_leave_whatsapp_core). Rollback-only, synthetic fixtures (fake 0700000xxx numbers).
-- Checks: flags + registration + consent + permission all required; list excludes own and >5-day requests; one-time code
-- (hashed, wrong attempts burn it, expiry); the decision updates exactly one row, logs, notifies; Twilio retry is a no-op;
-- a request that changed meanwhile is refused; no self-approval; permission parity with auth_has_permission; grants.
--   psql "$SUPABASE_DB_URL" -v ON_ERROR_STOP=1 -f supabase/tests/leave_whatsapp.sql
begin;

do $$
declare
  sa uuid := gen_random_uuid();
  u_a uuid := gen_random_uuid(); u_t uuid := gen_random_uuid(); su_a uuid := gen_random_uuid(); su_t uuid := gen_random_uuid();
  r_pr uuid; r_te uuid; f_dir uuid; f_hr uuid; lt uuid := gen_random_uuid();
  l_ok uuid := gen_random_uuid(); l_long uuid := gen_random_uuid(); l_own uuid := gen_random_uuid(); l_b uuid := gen_random_uuid();
  ph text := '+254700000611';
  v jsonb; v_code text; v_ref text; v_n integer; v_failed boolean; v_b boolean;
begin
  select id into r_pr from roles where name = 'principal';
  select id into r_te from roles where name = 'teacher';
  select id into f_dir from platform_feature_flags where key = 'feature.bot.director';
  select id into f_hr from platform_feature_flags where key = 'feature.bot.hr_approvals';
  assert f_hr is not null, 'flag catalog entry exists';
  assert not exists (select 1 from school_feature_flags where flag_id = f_hr and enabled), 'flag off everywhere';

  insert into schools (id, name, slug, application_number_prefix) values (sa, 'Leave WA Test', 'leavewa-test-a', 'LWT');
  insert into auth.users (id, aud, role, email) values
    (u_a, 'authenticated', 'authenticated', 'lw-a@example.invalid'), (u_t, 'authenticated', 'authenticated', 'lw-t@example.invalid');
  insert into school_users (id, school_id, auth_user_id, role_id, full_name, status, phone, gender) values
    (su_a, sa, u_a, r_pr, 'LW Principal', 'active', '0700000611', 'female'), (su_t, sa, u_t, r_te, 'LW Teacher', 'active', '0700000622', 'female');
  insert into leave_types (id, school_id, name) values (lt, sa, 'Annual');
  insert into leave_requests (id, school_id, staff_id, leave_type_id, start_date, end_date, days_count, status) values
    (l_ok, sa, su_t, lt, current_date + 5, current_date + 7, 3, 'pending'),
    (l_long, sa, su_t, lt, current_date + 20, current_date + 29, 10, 'pending'),
    (l_own, sa, su_a, lt, current_date + 40, current_date + 41, 2, 'pending'),
    (l_b, sa, su_t, lt, current_date + 50, current_date + 51, 2, 'pending');
  insert into director_whatsapp_numbers (school_id, school_user_id, phone, consent_text) values (sa, su_a, ph, 'test opt-in');

  -- 1. nothing works without the flags / consent
  assert (leave_wa_pending(ph) ->> 'status') = 'not_approver', '1: flags off';
  insert into school_feature_flags (school_id, flag_id, enabled) values (sa, f_dir, true), (sa, f_hr, true);
  assert (leave_wa_pending(ph) ->> 'status') = 'not_approver', '1: no consent yet';

  -- 2. consent through the real role: approver can, a teacher (no registration) cannot
  execute 'set local role authenticated';
  perform set_config('request.jwt.claims', json_build_object('sub', u_t, 'role', 'authenticated')::text, true);
  assert (leave_wa_consent_grant(true) ->> 'status') = 'register_number_first', '2: teacher cannot consent';
  perform set_config('request.jwt.claims', json_build_object('sub', u_a, 'role', 'authenticated')::text, true);
  assert (leave_wa_consent_grant(false) ->> 'status') = 'consent_required', '2: consent must be explicit';
  assert (leave_wa_consent_grant(true) ->> 'status') = 'granted', '2: approver consents';
  v_b := auth_has_permission('staff.leave.approve');
  execute 'reset role';
  assert v_b = leave_wa_effective_permission(su_a, 'staff.leave.approve'), '2: effective permission matches auth_has_permission (principal)';
  assert leave_wa_effective_permission(su_a, 'staff.leave.approve') = true and leave_wa_effective_permission(su_t, 'staff.leave.approve') = false, '2: principal yes, teacher no';

  -- 3. the list
  v := leave_wa_pending(ph);
  v_ref := upper(substr(md5(l_ok::text), 1, 4));
  assert v ->> 'status' = 'ok' and jsonb_array_length(v -> 'items') = 2 and (v ->> 'in_app_only')::int = 1, '3: two listable requests (3 and 2 days), the 10-day one counted as app-only';
  assert not exists (select 1 from jsonb_array_elements(v -> 'items') i where i ->> 'ref' in (upper(substr(md5(l_own::text), 1, 4)), upper(substr(md5(l_long::text), 1, 4)))), '3: own and over-5-day requests are not listed';
  assert exists (select 1 from jsonb_array_elements(v -> 'items') i where i ->> 'ref' = v_ref and i ->> 'name' = 'LW Teacher' and (i ->> 'days')::numeric = 3), '3: the 3-day request is listed with its derived ref';

  assert (leave_wa_request_code(ph, 'ZZZZ', 'approved') ->> 'status') = 'not_found', '4: unknown ref';
  assert (leave_wa_request_code(ph, upper(substr(md5(l_own::text), 1, 4)), 'approved') ->> 'status') = 'own_request', '4: own leave refused';
  assert (leave_wa_request_code(ph, upper(substr(md5(l_long::text), 1, 4)), 'approved') ->> 'status') = 'too_long', '4: over 5 days refused';
  v := leave_wa_request_code(ph, v_ref, 'approved');
  assert v ->> 'status' = 'code_issued' and (v ->> 'code') ~ '^[0-9]{6}$', '4: a 6-digit code is issued';
  v_code := v ->> 'code';
  assert not exists (select 1 from leave_wa_codes where code_hash = v_code), '4: the code is not stored in plain';

  -- 5. wrong attempts burn the code
  assert (leave_wa_decide(ph, case when v_code = '000000' then '111111' else '000000' end, 'SM-w1') ->> 'status') = 'wrong_code', '5: first wrong';
  v := leave_wa_decide(ph, case when v_code = '000000' then '111111' else '000000' end, 'SM-w2');
  assert v ->> 'status' = 'wrong_code' and (v ->> 'attempts_left')::int = 1, '5: second wrong, one attempt left';
  assert (leave_wa_decide(ph, case when v_code = '000000' then '111111' else '000000' end, 'SM-w3') ->> 'status') = 'locked', '5: third wrong locks';
  assert (leave_wa_decide(ph, v_code, 'SM-w4') ->> 'status') = 'no_code', '5: a burned code cannot be used even if right';
  assert (select status from leave_requests where id = l_ok) = 'pending', '5: nothing changed';

  -- 6. expiry
  v := leave_wa_request_code(ph, v_ref, 'approved'); v_code := v ->> 'code';
  update leave_wa_codes set expires_at = now() - interval '1 minute' where school_user_id = su_a and used_at is null;
  assert (leave_wa_decide(ph, v_code, 'SM-e1') ->> 'status') = 'expired', '6: expired';

  -- 7. the real decision
  v := leave_wa_request_code(ph, v_ref, 'approved'); v_code := v ->> 'code';
  v := leave_wa_decide(ph, v_code, 'SM-ok');
  assert v ->> 'status' = 'recorded' and v ->> 'decision' = 'approved', '7: recorded';
  assert exists (select 1 from leave_requests where id = l_ok and status = 'approved' and approved_by = su_a and approved_at is not null), '7: leave approved by the approver';
  assert exists (select 1 from leave_wa_decisions where leave_request_id = l_ok and approver_school_user_id = su_a and decision = 'approved' and message_sid = 'SM-ok' and channel = 'whatsapp'), '7: decision logged';
  assert exists (select 1 from notification_logs where recipient_school_user_id = su_t and subject = 'Leave request approved'), '7: requester notified';
  assert (leave_wa_decide(ph, v_code, 'SM-ok') ->> 'status') = 'duplicate', '7: a Twilio retry is a no-op';
  assert (leave_wa_decide(ph, v_code, 'SM-ok2') ->> 'status') = 'no_code', '7: a code works once';

  -- 8. the request changed between code and decision
  v := leave_wa_request_code(ph, upper(substr(md5(l_b::text), 1, 4)), 'rejected'); v_code := v ->> 'code';
  update leave_requests set status = 'cancelled' where id = l_b;
  assert (leave_wa_decide(ph, v_code, 'SM-late') ->> 'status') = 'no_longer_pending', '8: cancelled meanwhile -> refused';
  assert (select status from leave_requests where id = l_b) = 'cancelled', '8: left as cancelled';

  -- 9. consent withdrawn -> nothing works
  execute 'set local role authenticated';
  perform set_config('request.jwt.claims', json_build_object('sub', u_a, 'role', 'authenticated')::text, true);
  assert leave_wa_consent_revoke() = true, '9: revoke';
  execute 'reset role';
  assert (leave_wa_pending(ph) ->> 'status') = 'not_approver', '9: revoked consent';
  assert (leave_wa_decide(ph, '123456', 'SM-x') ->> 'status') = 'not_approver', '9: revoked consent cannot decide';

  -- 10. grants
  assert not has_function_privilege('anon', 'public.leave_wa_decide(text,text,text)', 'execute'), '10: anon decide';
  assert not has_function_privilege('authenticated', 'public.leave_wa_decide(text,text,text)', 'execute'), '10: authenticated decide';
  assert has_function_privilege('service_role', 'public.leave_wa_decide(text,text,text)', 'execute'), '10: service_role decide';
  assert not has_function_privilege('authenticated', 'public.leave_wa_pending(text)', 'execute'), '10: authenticated pending';
  assert not has_function_privilege('service_role', 'public.leave_wa_effective_permission(uuid,text)', 'execute'), '10: helper not callable';
  assert not has_function_privilege('service_role', 'public.leave_wa_verify(text)', 'execute'), '10: verify not callable';
  assert has_function_privilege('authenticated', 'public.leave_wa_consent_grant(boolean)', 'execute') and not has_function_privilege('anon', 'public.leave_wa_consent_grant(boolean)', 'execute'), '10: consent grants';
  assert not has_table_privilege('authenticated', 'public.leave_wa_codes', 'select'), '10: codes table closed';
end
$$;

rollback;

do $$
begin
  if exists (select 1 from schools where slug = 'leavewa-test-a') or exists (select 1 from auth.users where email like 'lw-%@example.invalid') then
    raise exception 'LEAK DETECTED: leave-whatsapp test fixtures were not rolled back -- fix this test file before trusting it again';
  end if;
end
$$;
