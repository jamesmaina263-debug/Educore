-- Behavioural test for Phase 2.4+2.5 (migration *_bot_guardian_requests). Rollback-only, synthetic fixtures.
--   psql "$SUPABASE_DB_URL" -v ON_ERROR_STOP=1 -f supabase/tests/bot_guardian_requests.sql
-- Needs the migration already deployed. Callers are simulated with request.jwt.claims + role
-- authenticated / service_role. The script opens with begin; and ends with rollback; and a final
-- tripwire fails loudly if any fixture row persisted. (CI: .github/workflows/bot-guardian-requests-behavior-check.yml)
begin;

do $$
declare
  sa uuid := gen_random_uuid();
  sb uuid := gen_random_uuid();
  u_owner uuid := gen_random_uuid();
  u_teacher uuid := gen_random_uuid();
  u_bursar uuid := gen_random_uuid();
  u_principal uuid := gen_random_uuid();
  u_owner_b uuid := gen_random_uuid();
  r_parent uuid; r_owner uuid; r_teacher uuid; r_bursar uuid; r_principal uuid; v_flag uuid;
  su_g1 uuid; su_g2 uuid; su_other uuid; su_g_b uuid;
  st1 uuid := gen_random_uuid(); st2 uuid := gen_random_uuid(); st_b uuid := gen_random_uuid();
  conv1 uuid; conv2 uuid; conv_b uuid;
  v_today date := (now() at time zone 'Africa/Nairobi')::date;
  v_failed boolean; v_res jsonb; v_id uuid; v_id2 uuid; v_n integer; v_list jsonb; v_phone text;
  v_att_before integer;
begin
  select id into r_parent from roles where name = 'parent';
  select id into r_owner from roles where name = 'school_owner';
  select id into r_teacher from roles where name = 'teacher';
  select id into r_bursar from roles where name = 'bursar';
  select id into r_principal from roles where name = 'principal';
  assert r_parent is not null and r_owner is not null and r_teacher is not null and r_bursar is not null and r_principal is not null, '0: roles exist';

  insert into auth.users (id, aud, role, email) values
    (u_owner, 'authenticated', 'authenticated', 'botreq-owner@example.invalid'),
    (u_teacher, 'authenticated', 'authenticated', 'botreq-teacher@example.invalid'),
    (u_bursar, 'authenticated', 'authenticated', 'botreq-bursar@example.invalid'),
    (u_principal, 'authenticated', 'authenticated', 'botreq-principal@example.invalid'),
    (u_owner_b, 'authenticated', 'authenticated', 'botreq-owner-b@example.invalid');
  insert into schools (id, name, slug, application_number_prefix) values
    (sa, 'Bot Req A', 'bot-req-a', 'BRA'), (sb, 'Bot Req B', 'bot-req-b', 'BRB');
  insert into school_users (auth_user_id, school_id, role_id, full_name, status) values
    (u_owner, sa, r_owner, 'Owner A', 'active'),
    (u_teacher, sa, r_teacher, 'Teacher A', 'active'),
    (u_bursar, sa, r_bursar, 'Bursar A', 'active'),
    (u_principal, sa, r_principal, 'Principal A', 'active'),
    (u_owner_b, sb, r_owner, 'Owner B', 'active');
  insert into school_users (school_id, role_id, full_name, phone, status) values (sa, r_parent, 'Guardian One', '+254700200001', 'active') returning id into su_g1;
  insert into school_users (school_id, role_id, full_name, phone, status) values (sa, r_parent, 'Guardian Two', '+254700200002', 'active') returning id into su_g2;
  insert into school_users (school_id, role_id, full_name, phone, status) values (sa, r_parent, 'Other Parent', '+254700200099', 'active') returning id into su_other;
  insert into school_users (school_id, role_id, full_name, phone, status) values (sb, r_parent, 'Guardian B', '+254700200003', 'active') returning id into su_g_b;

  insert into students (id, school_id, first_name, last_name, date_of_birth, gender, status) values
    (st1, sa, 'Amani', 'One', date '2012-01-01', 'male', 'approved'),
    (st2, sa, 'Baraka', 'Two', date '2012-01-02', 'male', 'approved'),
    (st_b, sb, 'Chege', 'Three', date '2012-01-03', 'male', 'approved');
  insert into student_guardians (student_id, guardian_user_id, relationship, primary_contact) values
    (st1, su_g1, 'guardian', true), (st2, su_g2, 'guardian', true), (st_b, su_g_b, 'guardian', true);

  insert into whatsapp_conversations (school_id, phone_number, guardian_user_id, status) values (sa, '+254700200001', su_g1, 'bot') returning id into conv1;
  insert into whatsapp_conversations (school_id, phone_number, guardian_user_id, status) values (sa, '+254700200002', su_g2, 'bot') returning id into conv2;
  insert into whatsapp_conversations (school_id, phone_number, guardian_user_id, status) values (sb, '+254700200003', su_g_b, 'bot') returning id into conv_b;

  select count(*) into v_att_before from student_attendance where student_id in (st1, st2);

  -- 1. phone normaliser
  assert bot_normalize_ke_phone('0712 345 678') = '+254712345678', '1: local format';
  assert bot_normalize_ke_phone('254712345678') = '+254712345678', '1: 254 format';
  assert bot_normalize_ke_phone('+254-112-345-678') = '+254112345678', '1: 01xx numbers and separators';
  assert bot_normalize_ke_phone('0212345678') is null, '1: not a mobile';
  assert bot_normalize_ke_phone('12345') is null and bot_normalize_ke_phone(null) is null, '1: junk';

  -- 2. flag OFF: everything refuses or returns nothing; the catalog entry exists and is on for nobody
  select id into v_flag from platform_feature_flags where key = 'feature.bot.guardian_requests';
  assert v_flag is not null, '2: flag catalog entry exists';
  assert not exists (select 1 from school_feature_flags where flag_id = v_flag and enabled), '2: flag enabled for nobody';
  execute 'set local role service_role';
  assert bot_guardian_requests_enabled(sa) = false, '2: enabled() false while off';
  v_res := bot_submit_absence_report(sa, conv1, su_g1, st1, v_today + 1, 'fever', 'raw');
  assert v_res->>'code' = 'flag_off' and (v_res->>'ok')::boolean = false, '2: absence refused while off';
  v_res := bot_submit_contact_update(sa, conv1, su_g1, '0711111111', 'raw');
  assert v_res->>'code' = 'flag_off', '2: contact refused while off';
  execute 'reset role';
  execute 'set local role authenticated';
  perform set_config('request.jwt.claims', json_build_object('sub', u_owner, 'role', 'authenticated')::text, true);
  assert bot_requests_for_review('all') = '[]'::jsonb, '2: queue empty while off';
  v_failed := false;
  begin perform bot_review_request(gen_random_uuid(), 'reject', null); exception when sqlstate '55000' then v_failed := true; end;
  assert v_failed, '2: review refused while off';
  execute 'reset role';
  assert (select count(*) from bot_guardian_requests) = 0, '2: nothing written while off';

  -- turn the flag on for school A only
  insert into school_feature_flags (school_id, flag_id, enabled) values (sa, v_flag, true);

  -- 3. absence notes
  execute 'set local role service_role';
  assert bot_guardian_requests_enabled(sa) = true and bot_guardian_requests_enabled(sb) = false, '3: on for A only';
  v_res := bot_submit_absence_report(sa, conv1, su_g1, st1, v_today + 1, '  fever  ', 'Amani absent tomorrow, fever');
  assert (v_res->>'ok')::boolean and not (v_res->>'duplicate')::boolean and v_res->>'id' is not null, '3: first note recorded';
  v_id := (v_res->>'id')::uuid;
  v_res := bot_submit_absence_report(sa, conv1, su_g1, st1, v_today + 1, 'again', 'again');
  assert (v_res->>'ok')::boolean and (v_res->>'duplicate')::boolean, '3: same child + day is a duplicate, not a second row';
  assert (select count(*) from bot_guardian_requests where student_id = st1 and kind = 'absence_report') = 1, '3: exactly one row';
  assert (select reason from bot_guardian_requests where id = v_id) = 'fever', '3: reason trimmed';
  -- yesterday and 30 days ahead are allowed; 2 days ago and 31 days ahead are not
  assert (bot_submit_absence_report(sa, conv1, su_g1, st1, v_today - 1, null, 'x')->>'ok')::boolean, '3: yesterday allowed';
  assert (bot_submit_absence_report(sa, conv1, su_g1, st1, v_today + 30, null, 'x')->>'ok')::boolean, '3: +30 days allowed';
  assert bot_submit_absence_report(sa, conv1, su_g1, st1, v_today - 2, null, 'x')->>'code' = 'bad_date', '3: 2 days ago refused';
  assert bot_submit_absence_report(sa, conv1, su_g1, st1, v_today + 31, null, 'x')->>'code' = 'bad_date', '3: 31 days ahead refused';
  assert bot_submit_absence_report(sa, conv1, su_g1, st1, null, null, 'x')->>'code' = 'bad_date', '3: null date refused';
  -- wrong combinations
  assert bot_submit_absence_report(sa, conv1, su_g1, st2, v_today + 1, null, 'x')->>'code' = 'not_linked', '3: guardian not linked to that child';
  assert bot_submit_absence_report(sa, conv1, su_g1, st_b, v_today + 1, null, 'x')->>'code' = 'not_linked', '3: child of another school';
  assert bot_submit_absence_report(sa, conv2, su_g1, st1, v_today + 1, null, 'x')->>'code' = 'bad_conversation', '3: conversation of another guardian';
  assert bot_submit_absence_report(sb, conv1, su_g1, st1, v_today + 1, null, 'x')->>'code' = 'flag_off', '3: wrong school id refused (flag off there)';
  execute 'reset role';
  assert (select count(*) from student_attendance where student_id in (st1, st2)) = v_att_before, '3: the attendance register is never written';

  -- 4. contact updates
  execute 'set local role service_role';
  v_res := bot_submit_contact_update(sa, conv1, su_g1, '0711 000 111', 'change my number');
  assert (v_res->>'ok')::boolean, '4: request queued';
  v_id := (v_res->>'id')::uuid;
  assert (select new_phone from bot_guardian_requests where id = v_id) = '+254711000111', '4: stored normalised';
  v_res := bot_submit_contact_update(sa, conv1, su_g1, '0722000222', 'again');
  v_id2 := (v_res->>'id')::uuid;
  assert (select status from bot_guardian_requests where id = v_id) = 'cancelled', '4: newer request replaces the older open one';
  assert (select status from bot_guardian_requests where id = v_id2) = 'pending', '4: newer request pending';
  assert bot_submit_contact_update(sa, conv1, su_g1, '0700 200 001', 'same')->>'code' = 'same_number', '4: same number refused';
  assert bot_submit_contact_update(sa, conv1, su_g1, 'abc', 'junk')->>'code' = 'bad_phone', '4: junk refused';
  assert bot_submit_contact_update(sa, conv2, su_g1, '0733000333', 'x')->>'code' = 'bad_conversation', '4: wrong conversation';
  execute 'reset role';
  assert (select phone from school_users where id = su_g1) = '+254700200001', '4: the phone number is NOT changed by the bot';

  -- 5. direct table access: clients cannot write; staff read through RLS (own school, communication.read)
  execute 'set local role authenticated';
  perform set_config('request.jwt.claims', json_build_object('sub', u_owner, 'role', 'authenticated')::text, true);
  v_failed := false;
  begin
    insert into bot_guardian_requests (school_id, conversation_id, guardian_user_id, student_id, kind, absence_date)
    values (sa, conv1, su_g1, st1, 'absence_report', v_today + 2);
  exception when insufficient_privilege then v_failed := true; end;
  assert v_failed, '5: authenticated cannot insert';
  v_failed := false;
  begin update bot_guardian_requests set status = 'applied'; exception when insufficient_privilege then v_failed := true; end;
  assert v_failed, '5: authenticated cannot update';
  select count(*) into v_n from bot_guardian_requests;
  assert v_n >= 3, '5: owner A sees school A rows';
  perform set_config('request.jwt.claims', json_build_object('sub', u_bursar, 'role', 'authenticated')::text, true);
  select count(*) into v_n from bot_guardian_requests;
  assert v_n >= 3, '5: bursar (communication.read) sees rows';
  perform set_config('request.jwt.claims', json_build_object('sub', u_teacher, 'role', 'authenticated')::text, true);
  select count(*) into v_n from bot_guardian_requests;
  assert v_n = 0, '5: teacher (no communication.read) sees nothing';
  perform set_config('request.jwt.claims', json_build_object('sub', u_owner_b, 'role', 'authenticated')::text, true);
  select count(*) into v_n from bot_guardian_requests;
  assert v_n = 0, '5: owner of school B sees nothing of school A';
  execute 'reset role';

  -- 6. the staff queue function
  execute 'set local role authenticated';
  perform set_config('request.jwt.claims', json_build_object('sub', u_owner, 'role', 'authenticated')::text, true);
  v_list := bot_requests_for_review('pending');
  assert jsonb_array_length(v_list) >= 3, '6: owner sees pending rows';
  assert (select bool_and(x->>'status' = 'pending') from jsonb_array_elements(v_list) x), '6: only pending returned';
  assert not exists (select 1 from jsonb_array_elements(v_list) x where x ? 'raw_text' or x ? 'conversation_id'), '6: no raw chat text in the queue';
  v_failed := false;
  begin perform bot_requests_for_review('bogus'); exception when sqlstate '22023' then v_failed := true; end;
  assert v_failed, '6: invalid filter refused';
  perform set_config('request.jwt.claims', json_build_object('sub', u_teacher, 'role', 'authenticated')::text, true);
  assert bot_requests_for_review('all') = '[]'::jsonb, '6: teacher gets an empty queue';
  perform set_config('request.jwt.claims', json_build_object('sub', u_owner_b, 'role', 'authenticated')::text, true);
  assert bot_requests_for_review('all') = '[]'::jsonb, '6: school B gets an empty queue (flag off there)';
  execute 'reset role';

  -- 7. review: permissions per kind
  select id into v_id from bot_guardian_requests where kind = 'absence_report' and student_id = st1 and absence_date = v_today + 1;
  execute 'set local role authenticated';
  perform set_config('request.jwt.claims', json_build_object('sub', u_bursar, 'role', 'authenticated')::text, true);
  v_failed := false;
  begin perform bot_review_request(v_id, 'acknowledge', null); exception when sqlstate '42501' then v_failed := true; end;
  assert v_failed, '7: bursar (no attendance.mark) cannot acknowledge an absence note';
  perform set_config('request.jwt.claims', json_build_object('sub', u_owner_b, 'role', 'authenticated')::text, true);
  v_failed := false;
  begin perform bot_review_request(v_id, 'acknowledge', null); exception when sqlstate '55000' then v_failed := true; end;
  assert v_failed, '7: school B (flag off) cannot touch it';
  perform set_config('request.jwt.claims', json_build_object('sub', u_teacher, 'role', 'authenticated')::text, true);
  v_failed := false;
  begin perform bot_review_request(v_id, 'apply', null); exception when sqlstate '22023' then v_failed := true; end;
  assert v_failed, '7: an absence note cannot be "applied"';
  v_res := bot_review_request(v_id, 'acknowledge', 'Seen, thanks');
  assert v_res->>'status' = 'acknowledged', '7: teacher (attendance.mark) acknowledges';
  v_failed := false;
  begin perform bot_review_request(v_id, 'reject', null); exception when sqlstate '55000' then v_failed := true; end;
  assert v_failed, '7: a decided request cannot be decided again';
  execute 'reset role';
  assert (select status from bot_guardian_requests where id = v_id) = 'acknowledged'
     and (select reviewed_by from bot_guardian_requests where id = v_id) is not null
     and (select review_note from bot_guardian_requests where id = v_id) = 'Seen, thanks', '7: review fields recorded';
  assert exists (select 1 from audit_log where record_id = v_id and action = 'bot_request_acknowledge'), '7: audit row written';
  assert (select count(*) from student_attendance where student_id in (st1, st2)) = v_att_before, '7: acknowledging never writes the register';

  -- 8. review: phone changes need students.write
  select id into v_id2 from bot_guardian_requests where kind = 'contact_update' and status = 'pending' and guardian_user_id = su_g1;
  execute 'set local role authenticated';
  perform set_config('request.jwt.claims', json_build_object('sub', u_teacher, 'role', 'authenticated')::text, true);
  v_failed := false;
  begin perform bot_review_request(v_id2, 'apply', null); exception when sqlstate '42501' then v_failed := true; end;
  assert v_failed, '8: teacher (no students.write) cannot change a number';
  perform set_config('request.jwt.claims', json_build_object('sub', u_principal, 'role', 'authenticated')::text, true);
  v_failed := false;
  begin perform bot_review_request(v_id2, 'acknowledge', null); exception when sqlstate '22023' then v_failed := true; end;
  assert v_failed, '8: a phone change cannot be "acknowledged"';
  v_res := bot_review_request(v_id2, 'apply', 'Called and confirmed');
  assert v_res->>'status' = 'applied', '8: principal applies';
  execute 'reset role';
  assert (select phone from school_users where id = su_g1) = '+254722000222', '8: number changed only after approval';
  assert exists (select 1 from audit_log where record_id = v_id2 and action = 'bot_request_apply'
                   and old_data->>'phone' = '+254700200001' and new_data->>'new_phone' = '+254722000222'), '8: audit row has old and new number';

  -- 9. a number that already belongs to someone else cannot be applied
  execute 'set local role service_role';
  v_res := bot_submit_contact_update(sa, conv2, su_g2, '0700200099', 'take Other Parent number');
  assert (v_res->>'ok')::boolean, '9: queued (the conflict is shown to staff)';
  v_id := (v_res->>'id')::uuid;
  execute 'reset role';
  execute 'set local role authenticated';
  perform set_config('request.jwt.claims', json_build_object('sub', u_principal, 'role', 'authenticated')::text, true);
  assert (select (x->>'phone_conflict')::boolean from jsonb_array_elements(bot_requests_for_review('pending')) x where x->>'id' = v_id::text), '9: conflict flagged in the queue';
  v_failed := false;
  begin perform bot_review_request(v_id, 'apply', null); exception when sqlstate '23505' then v_failed := true; end;
  assert v_failed, '9: apply refused on a conflicting number';
  assert (bot_review_request(v_id, 'reject', 'Number belongs to another parent')->>'status') = 'rejected', '9: can still be rejected';
  execute 'reset role';
  assert (select phone from school_users where id = su_g2) = '+254700200002', '9: guardian two keeps their number';

  -- 10. rate limit: 10 requests in 24 hours, then refused
  execute 'reset role';
  insert into bot_guardian_requests (school_id, conversation_id, guardian_user_id, kind, status, new_phone)
  select sa, conv2, su_g2, 'contact_update', 'cancelled', '+25471000' || lpad(g::text, 4, '0') from generate_series(1, 10) g;
  execute 'set local role service_role';
  assert bot_submit_absence_report(sa, conv2, su_g2, st2, v_today + 3, null, 'x')->>'code' = 'rate_limited', '10: absence rate limited';
  assert bot_submit_contact_update(sa, conv2, su_g2, '0744000444', 'x')->>'code' = 'rate_limited', '10: contact rate limited';
  execute 'reset role';

  -- 11. grants
  assert not has_function_privilege('anon', 'public.bot_requests_for_review(text)', 'execute'), '11: anon queue';
  assert not has_function_privilege('anon', 'public.bot_review_request(uuid,text,text)', 'execute'), '11: anon review';
  assert not has_function_privilege('anon', 'public.bot_submit_absence_report(uuid,uuid,uuid,uuid,date,text,text)', 'execute'), '11: anon absence';
  assert not has_function_privilege('anon', 'public.bot_submit_contact_update(uuid,uuid,uuid,text,text)', 'execute'), '11: anon contact';
  assert not has_function_privilege('anon', 'public.bot_guardian_requests_enabled(uuid)', 'execute'), '11: anon enabled';
  assert not has_function_privilege('authenticated', 'public.bot_submit_absence_report(uuid,uuid,uuid,uuid,date,text,text)', 'execute'), '11: clients cannot submit absence';
  assert not has_function_privilege('authenticated', 'public.bot_submit_contact_update(uuid,uuid,uuid,text,text)', 'execute'), '11: clients cannot submit contact';
  assert not has_function_privilege('authenticated', 'public.bot_guardian_requests_enabled(uuid)', 'execute'), '11: clients cannot ask enabled()';
  assert has_function_privilege('service_role', 'public.bot_submit_absence_report(uuid,uuid,uuid,uuid,date,text,text)', 'execute'), '11: service role can submit';
  assert has_function_privilege('authenticated', 'public.bot_review_request(uuid,text,text)', 'execute'), '11: staff can review';
  assert not has_table_privilege('anon', 'public.bot_guardian_requests', 'select'), '11: anon cannot read the table';

  raise notice 'bot guardian requests behavioural checks: all passed';
end
$$;

rollback;

-- Independent tripwire, in its own implicit transaction after the explicit rollback above.
do $$
begin
  if exists (select 1 from schools where slug in ('bot-req-a', 'bot-req-b'))
     or exists (select 1 from auth.users where email like 'botreq-%@example.invalid') then
    raise exception 'LEAK DETECTED: bot guardian requests test fixtures were not rolled back -- fix this test file before trusting it again';
  end if;
end
$$;
