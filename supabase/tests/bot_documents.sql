-- Behavioural test for Phase 2.1+2.2 (migration *_bot_documents). Rollback-only, synthetic fixtures.
--   psql "$SUPABASE_DB_URL" -v ON_ERROR_STOP=1 -f supabase/tests/bot_documents.sql
-- Needs the migration already deployed. A passing run ends with the error MY_TEST_PASSED (and rolls back).
-- Callers are simulated with request.jwt.claims + role authenticated / service_role.
begin;

do $$
declare
  sa uuid := gen_random_uuid();
  u_parent uuid := gen_random_uuid();
  u_parent2 uuid := gen_random_uuid();
  u_teacher uuid := gen_random_uuid();
  r_parent uuid; r_teacher uuid; v_flag uuid;
  su_parent uuid; su_parent2 uuid; su_teacher uuid;
  st1 uuid := gen_random_uuid(); st_other uuid := gen_random_uuid();
  conv1 uuid; conv2 uuid;
  v_failed boolean; v_res jsonb; v_id uuid; v_req uuid; v_i integer; v_hash text;
begin
  select id into r_parent from roles where name = 'parent';
  select id into r_teacher from roles where name = 'teacher';
  assert r_parent is not null and r_teacher is not null, 'roles exist';

  insert into auth.users (id, aud, role, email) values
    (u_parent, 'authenticated', 'authenticated', 'botdoc-parent@example.invalid'),
    (u_parent2, 'authenticated', 'authenticated', 'botdoc-parent2@example.invalid'),
    (u_teacher, 'authenticated', 'authenticated', 'botdoc-teacher@example.invalid');
  insert into schools (id, name, slug, application_number_prefix) values (sa, 'Bot Doc A', 'bot-doc-a', 'BDA');
  insert into school_users (auth_user_id, school_id, role_id, full_name, phone, status) values
    (u_parent, sa, r_parent, 'Parent One', '+254700100001', 'active'),
    (u_parent2, sa, r_parent, 'Parent Two', '+254700100002', 'active'),
    (u_teacher, sa, r_teacher, 'Teacher', null, 'active');
  select id into su_parent from school_users where auth_user_id = u_parent;
  select id into su_parent2 from school_users where auth_user_id = u_parent2;
  select id into su_teacher from school_users where auth_user_id = u_teacher;

  insert into students (id, school_id, first_name, last_name, date_of_birth, gender, status) values
    (st1, sa, 'Sam', 'One', date '2012-01-01', 'male', 'approved'),
    (st_other, sa, 'Olu', 'Other', date '2012-01-02', 'male', 'approved');
  insert into student_guardians (student_id, guardian_user_id, relationship, primary_contact) values
    (st1, su_parent, 'parent', true), (st_other, su_parent2, 'parent', true);

  insert into whatsapp_conversations (school_id, phone_number, guardian_user_id, status)
    values (sa, '+254700100001', su_parent, 'bot') returning id into conv1;
  insert into whatsapp_conversations (school_id, phone_number, guardian_user_id, status)
    values (sa, '+254700100002', su_parent2, 'bot') returning id into conv2;

  -- 1. flag OFF: PIN setting and bot request both refused (55000); the flag catalog entry exists
  execute 'set local role authenticated';
  perform set_config('request.jwt.claims', json_build_object('sub', u_parent, 'role', 'authenticated')::text, true);
  v_failed := false;
  begin perform set_bot_pin('2580'); exception when sqlstate '55000' then v_failed := true; end;
  assert v_failed, '1: flag off must refuse set_bot_pin';
  execute 'reset role';
  execute 'set local role service_role';
  v_failed := false;
  begin perform bot_begin_document_request(sa, conv1, su_parent, st1, 'statement'); exception when sqlstate '55000' then v_failed := true; end;
  assert v_failed, '1: flag off must refuse bot_begin_document_request';
  assert bot_documents_enabled(sa) = false, '1: enabled() false while off';
  execute 'reset role';
  select id into v_flag from platform_feature_flags where key = 'feature.bot.documents';
  assert v_flag is not null, '1: flag catalog entry exists';
  assert not exists (select 1 from school_feature_flags where flag_id = v_flag), '1: flag enabled for nobody';

  -- turn the flag on for school A (as superuser)
  insert into school_feature_flags (school_id, flag_id, enabled) values (sa, v_flag, true);

  -- 2. a non-parent cannot set a PIN
  execute 'set local role authenticated';
  perform set_config('request.jwt.claims', json_build_object('sub', u_teacher, 'role', 'authenticated')::text, true);
  v_failed := false;
  begin perform set_bot_pin('2580'); exception when sqlstate '42501' then v_failed := true; end;
  assert v_failed, '2: teacher must be refused';

  -- 3. PIN validation: shape and weak PINs
  perform set_config('request.jwt.claims', json_build_object('sub', u_parent, 'role', 'authenticated')::text, true);
  foreach v_hash in array array['abc', '123', '1234567', '0000', '1234', '4321', '9999', '12345'] loop
    v_failed := false;
    begin perform set_bot_pin(v_hash); exception when sqlstate '22023' then v_failed := true; end;
    assert v_failed, '3: PIN ' || v_hash || ' must be refused';
  end loop;
  assert bot_pin_is_set() = false, '3: no PIN yet';
  perform set_bot_pin('2580');
  assert bot_pin_is_set() = true, '3: PIN set';

  -- 4. clients cannot read or write the tables directly; the hash is not the PIN
  v_failed := false;
  begin perform count(*) from bot_guardian_pins; exception when insufficient_privilege then v_failed := true; end;
  assert v_failed, '4: authenticated cannot read pins';
  v_failed := false;
  begin perform count(*) from bot_document_requests; exception when insufficient_privilege then v_failed := true; end;
  assert v_failed, '4: authenticated cannot read requests';
  execute 'reset role';
  select pin_hash into v_hash from bot_guardian_pins where guardian_user_id = su_parent;
  assert v_hash is not null and v_hash <> '2580' and v_hash like '$2%', '4: stored value is a bcrypt hash';
  assert bot_documents_enabled(sa) = true, '4: enabled() true when on';

  -- 5. service role: wrong guardian/student/conversation combinations refused
  execute 'set local role service_role';
  v_failed := false;
  begin perform bot_begin_document_request(sa, conv1, su_parent, st_other, 'statement'); exception when sqlstate '42501' then v_failed := true; end;
  assert v_failed, '5: guardian not linked to the student';
  v_failed := false;
  begin perform bot_begin_document_request(sa, conv2, su_parent, st1, 'statement'); exception when sqlstate '42501' then v_failed := true; end;
  assert v_failed, '5: conversation of another guardian';
  v_failed := false;
  begin perform bot_begin_document_request(sa, conv1, su_parent, st1, 'passport'); exception when sqlstate '22023' then v_failed := true; end;
  assert v_failed, '5: unknown document type';

  -- 6. guardian without a PIN is told so, no request is created
  v_res := bot_begin_document_request(sa, conv2, su_parent2, st_other, 'report_card');
  assert v_res->>'status' = 'no_pin', '6: no_pin expected, got ' || v_res::text;
  assert (select count(*) from bot_document_requests where conversation_id = conv2) = 0, '6: no request row';

  -- 7. happy path: begin -> pending -> wrong PIN -> right PIN -> claim once -> complete
  v_res := bot_begin_document_request(sa, conv1, su_parent, st1, 'statement');
  assert v_res->>'status' = 'awaiting_pin', '7: awaiting_pin expected';
  v_req := (v_res->>'request_id')::uuid;
  assert bot_pending_pin_request(conv1) = v_req, '7: pending request found';
  v_res := bot_submit_pin(conv1, '1111');
  assert v_res->>'result' = 'wrong' and (v_res->>'attempts_left')::int = 4, '7: wrong PIN, 4 left, got ' || v_res::text;
  assert bot_claim_document_request(v_req) is null, '7: cannot claim before the PIN is verified';
  v_res := bot_submit_pin(conv1, '2580');
  assert v_res->>'result' = 'ok' and (v_res->>'request_id')::uuid = v_req and v_res->>'doc_type' = 'statement', '7: PIN ok';
  assert bot_pending_pin_request(conv1) is null, '7: no longer pending after success';
  v_res := bot_claim_document_request(v_req);
  assert v_res is not null and (v_res->>'student_id')::uuid = st1 and v_res->>'doc_type' = 'statement', '7: claim returns the request';
  assert bot_claim_document_request(v_req) is null, '7: second claim refused (one-shot)';
  perform bot_complete_document_request(v_req, 'delivered');
  assert (select status from bot_document_requests where id = v_req) = 'delivered', '7: delivered recorded';
  v_failed := false;
  begin perform bot_complete_document_request(v_req, 'exploded'); exception when sqlstate '22023' then v_failed := true; end;
  assert v_failed, '7: invalid outcome refused';

  -- 8. lockout: 5 wrong PINs lock for 30 minutes, even the right PIN is then refused
  v_res := bot_begin_document_request(sa, conv1, su_parent, st1, 'report_card');
  assert v_res->>'status' = 'awaiting_pin', '8: new request';
  for v_i in 1..4 loop
    v_res := bot_submit_pin(conv1, '1111');
    assert v_res->>'result' = 'wrong', '8: wrong #' || v_i;
  end loop;
  v_res := bot_submit_pin(conv1, '1111');
  assert v_res->>'result' = 'locked', '8: locked on the 5th wrong attempt, got ' || v_res::text;
  v_res := bot_begin_document_request(sa, conv1, su_parent, st1, 'report_card');
  v_res := bot_submit_pin(conv1, '2580');
  assert v_res->>'result' = 'locked', '8: right PIN refused while locked, got ' || v_res::text;
  assert (select count(*) from bot_document_requests where conversation_id = conv1 and status in ('awaiting_pin', 'pin_verified', 'generating')) = 0, '8: no open request left behind';

  -- 9. the guardian resetting their PIN in the portal clears the lock
  execute 'reset role';
  execute 'set local role authenticated';
  perform set_config('request.jwt.claims', json_build_object('sub', u_parent, 'role', 'authenticated')::text, true);
  perform set_bot_pin('7391');
  execute 'reset role';
  assert (select locked_until from bot_guardian_pins where guardian_user_id = su_parent) is null, '9: lock cleared';
  execute 'set local role service_role';
  v_res := bot_begin_document_request(sa, conv1, su_parent, st1, 'report_card');
  v_res := bot_submit_pin(conv1, '7391');
  assert v_res->>'result' = 'ok', '9: new PIN works, got ' || v_res::text;
  perform bot_complete_document_request((v_res->>'request_id')::uuid, 'denied', 'no released report card');
  assert (select failure_reason from bot_document_requests where id = (v_res->>'request_id')::uuid) = 'no released report card', '9: reason stored';

  -- 10. expiry: a request older than its window is not answerable
  v_res := bot_begin_document_request(sa, conv1, su_parent, st1, 'statement');
  v_req := (v_res->>'request_id')::uuid;
  execute 'reset role';
  update bot_document_requests set expires_at = now() - interval '1 minute' where id = v_req;
  execute 'set local role service_role';
  assert bot_pending_pin_request(conv1) is null, '10: expired request not pending';
  assert (select status from bot_document_requests where id = v_req) = 'expired', '10: marked expired';
  assert bot_submit_pin(conv1, '7391')->>'result' = 'none', '10: submit after expiry does nothing';

  -- 11. a request stuck in generating does not block the conversation forever
  execute 'reset role';
  insert into bot_document_requests (school_id, conversation_id, guardian_user_id, student_id, doc_type, status, expires_at, pin_verified_at)
    values (sa, conv1, su_parent, st1, 'statement', 'generating', now() + interval '5 minutes', now() - interval '20 minutes');
  execute 'set local role service_role';
  v_res := bot_begin_document_request(sa, conv1, su_parent, st1, 'statement');
  assert v_res->>'status' = 'awaiting_pin', '11: stuck generating request was timed out, got ' || v_res::text;

  -- 12. daily cap: 10 delivered in 24h
  execute 'reset role';
  for v_i in 1..10 loop
    insert into bot_document_requests (school_id, conversation_id, guardian_user_id, student_id, doc_type, status, expires_at, completed_at)
      values (sa, conv1, su_parent, st1, 'statement', 'delivered', now(), now());
  end loop;
  execute 'set local role service_role';
  v_res := bot_begin_document_request(sa, conv1, su_parent, st1, 'statement');
  assert v_res->>'status' = 'daily_limit', '12: daily limit, got ' || v_res::text;

  -- 13. privileges: bot functions are service_role only; the portal ones are not anon
  execute 'reset role';
  assert not has_function_privilege('anon', 'public.set_bot_pin(text)', 'execute'), '13: anon set_bot_pin';
  assert not has_function_privilege('anon', 'public.bot_pin_is_set()', 'execute'), '13: anon pin_is_set';
  assert has_function_privilege('authenticated', 'public.set_bot_pin(text)', 'execute'), '13: authenticated set_bot_pin';
  assert not has_function_privilege('anon', 'public.bot_begin_document_request(uuid,uuid,uuid,uuid,text)', 'execute'), '13: anon begin';
  assert not has_function_privilege('authenticated', 'public.bot_begin_document_request(uuid,uuid,uuid,uuid,text)', 'execute'), '13: authenticated begin';
  assert not has_function_privilege('authenticated', 'public.bot_submit_pin(uuid,text)', 'execute'), '13: authenticated submit';
  assert not has_function_privilege('authenticated', 'public.bot_pending_pin_request(uuid)', 'execute'), '13: authenticated pending';
  assert not has_function_privilege('authenticated', 'public.bot_claim_document_request(uuid)', 'execute'), '13: authenticated claim';
  assert not has_function_privilege('authenticated', 'public.bot_complete_document_request(uuid,text,text)', 'execute'), '13: authenticated complete';
  assert not has_function_privilege('authenticated', 'public.bot_documents_enabled(uuid)', 'execute'), '13: authenticated enabled';
  assert has_function_privilege('service_role', 'public.bot_submit_pin(uuid,text)', 'execute'), '13: service_role submit';

  -- 14. the bucket is private and PDF-only
  assert (select public from storage.buckets where id = 'bot-documents') = false, '14: bucket private';
  assert (select allowed_mime_types from storage.buckets where id = 'bot-documents') = array['application/pdf'], '14: PDF only';

  raise exception 'MY_TEST_PASSED';
end
$$;
rollback;
