-- Behavioral test for Phase 7.1 (recruitment pipeline). Rollback-only, synthetic fixtures, real role
-- impersonation (request.jwt.claims), real deployed functions and policies. Same safety model as
-- events_houses_calendar.sql: opens with `begin;`, ends with `rollback;`, and a tripwire in its own
-- transaction fails loudly if any fixture persisted.
--   psql "$SUPABASE_DB_URL" -v ON_ERROR_STOP=1 -f supabase/tests/recruitment_pipeline.sql
begin;

do $$
declare
  sa uuid := gen_random_uuid();
  sb uuid := gen_random_uuid();
  r_hr uuid;
  r_parent uuid;
  a_hr uuid := gen_random_uuid();
  a_parent uuid := gen_random_uuid();
  a_other uuid := gen_random_uuid();
  v_flag uuid;
  v_open uuid; v_open2 uuid; v_c1 uuid; v_c2 uuid;
  v_n int; v_failed boolean; v_state text; v_stage text;
begin
  select id into r_hr from roles where name = 'deputy_principal';
  select id into r_parent from roles where name = 'parent';
  assert r_hr is not null and r_parent is not null, 'fixture roles exist';

  insert into schools (id, name, slug, application_number_prefix) values
    (sa, 'Rec Test A', 'rec-test-a', 'RTA'), (sb, 'Rec Test B', 'rec-test-b', 'RTB');
  insert into auth.users (id, aud, role, email) values
    (a_hr, 'authenticated', 'authenticated', 'rec-hr@example.invalid'),
    (a_parent, 'authenticated', 'authenticated', 'rec-parent@example.invalid'),
    (a_other, 'authenticated', 'authenticated', 'rec-other@example.invalid');
  insert into school_users (school_id, auth_user_id, role_id, full_name, status) values
    (sa, a_hr, r_hr, 'Rec HR', 'active'),
    (sa, a_parent, r_parent, 'Rec Parent', 'active'),
    (sb, a_other, r_hr, 'Rec Other HR', 'active');
  select id into v_flag from platform_feature_flags where lower(key) = 'feature.hr.recruitment';
  assert v_flag is not null, 'flag catalog entry exists';

  -- 1. flag off: refused with 55000
  set local role authenticated;
  perform set_config('request.jwt.claims', json_build_object('sub', a_hr, 'role', 'authenticated')::text, true);
  v_failed := false;
  begin
    perform save_recruitment_opening(null, 'Maths teacher', null, 'full_time', null, 1, null, 'open');
  exception when others then
    get stacked diagnostics v_state = returned_sqlstate; v_failed := (v_state = '55000');
  end;
  reset role;
  assert v_failed, '1: flag off refused with 55000';

  insert into school_feature_flags (school_id, flag_id, enabled) values (sa, v_flag, true);

  -- 2. a person without staff.manage is refused (42501) and sees nothing
  set local role authenticated;
  perform set_config('request.jwt.claims', json_build_object('sub', a_parent, 'role', 'authenticated')::text, true);
  v_failed := false;
  begin
    perform save_recruitment_opening(null, 'x', null, 'full_time', null, 1, null, 'open');
  exception when others then
    get stacked diagnostics v_state = returned_sqlstate; v_failed := (v_state = '42501');
  end;
  assert v_failed, '2: non-holder refused with 42501';
  select count(*) into v_n from recruitment_openings;
  assert v_n = 0, '2: non-holder sees no openings';
  reset role;

  -- 3. HR creates a draft opening: candidates cannot be added until it is open
  set local role authenticated;
  perform set_config('request.jwt.claims', json_build_object('sub', a_hr, 'role', 'authenticated')::text, true);
  v_open := save_recruitment_opening(null, 'Maths teacher', 'Sciences', 'full_time', 'Form 3 and 4', 2, date '2026-12-01', 'draft');
  v_failed := false;
  begin
    perform add_recruitment_candidate(v_open, 'Too Early', 'early@example.invalid', null, null);
  exception when others then
    get stacked diagnostics v_state = returned_sqlstate; v_failed := (v_state = '22023');
  end;
  assert v_failed, '3: draft opening refuses candidates';
  v_open := save_recruitment_opening(v_open, 'Maths teacher', 'Sciences', 'full_time', 'Form 3 and 4', 2, date '2026-12-01', 'open');

  -- 4. add candidates; duplicate email refused; invalid email refused
  v_c1 := add_recruitment_candidate(v_open, 'Alice Wanjiru', 'alice@example.invalid', '+254700000001', 'Referral');
  v_c2 := add_recruitment_candidate(v_open, 'Brian Otieno', null, null, null);
  v_failed := false;
  begin
    perform add_recruitment_candidate(v_open, 'Alice Again', ' ALICE@example.invalid ', null, null);
  exception when others then
    get stacked diagnostics v_state = returned_sqlstate; v_failed := (v_state = '23505');
  end;
  assert v_failed, '4: duplicate email on the same opening refused';
  v_failed := false;
  begin
    perform add_recruitment_candidate(v_open, 'Bad Email', 'not-an-email', null, null);
  exception when others then
    get stacked diagnostics v_state = returned_sqlstate; v_failed := (v_state = '22023');
  end;
  assert v_failed, '4: invalid email refused';

  -- 5. stage rules
  v_failed := false;
  begin perform move_recruitment_candidate(v_c1, 'offer', null);
  exception when others then get stacked diagnostics v_state = returned_sqlstate; v_failed := (v_state = '22023'); end;
  assert v_failed, '5: cannot skip stages';
  perform move_recruitment_candidate(v_c1, 'shortlisted', null);
  perform move_recruitment_candidate(v_c1, 'interview', 'Panel on Monday');
  perform move_recruitment_candidate(v_c1, 'offer', null);
  perform move_recruitment_candidate(v_c1, 'hired', null);
  v_failed := false;
  begin perform move_recruitment_candidate(v_c1, 'rejected', 'changed mind');
  exception when others then get stacked diagnostics v_state = returned_sqlstate; v_failed := (v_state = '22023'); end;
  assert v_failed, '5: hired is final';
  v_failed := false;
  begin perform move_recruitment_candidate(v_c2, 'rejected', '   ');
  exception when others then get stacked diagnostics v_state = returned_sqlstate; v_failed := (v_state = '22023'); end;
  assert v_failed, '5: rejection needs a reason';
  perform move_recruitment_candidate(v_c2, 'rejected', 'Not qualified for Form 4');
  perform add_recruitment_note(v_c2, 'Spoke by phone first');

  -- 6. history is complete and ordered
  select count(*) into v_n from recruitment_events where candidate_id = v_c1 and kind = 'stage';
  assert v_n = 5, '6: five stage events for the hired candidate (applied + 4 moves)';
  select count(*) into v_n from recruitment_events where candidate_id = v_c2;
  assert v_n = 3, '6: applied, rejected and one note for the rejected candidate';
  select stage into v_stage from recruitment_candidates where id = v_c1;
  assert v_stage = 'hired', '6: stage persisted';

  -- 7. a cancelled opening cannot be reopened
  v_open2 := save_recruitment_opening(null, 'Cook', null, 'contract', null, 1, null, 'cancelled');
  v_failed := false;
  begin perform save_recruitment_opening(v_open2, 'Cook', null, 'contract', null, 1, null, 'open');
  exception when others then get stacked diagnostics v_state = returned_sqlstate; v_failed := (v_state = '22023'); end;
  assert v_failed, '7: cancelled stays cancelled';

  -- 8. direct writes are blocked for clients
  v_failed := false;
  begin insert into recruitment_candidates (school_id, opening_id, full_name) values (sa, v_open, 'Sneaky');
  exception when others then get stacked diagnostics v_state = returned_sqlstate; v_failed := (v_state = '42501'); end;
  assert v_failed, '8: direct insert blocked';
  update recruitment_events set body = 'tampered' where candidate_id = v_c2;
  get diagnostics v_n = row_count;
  assert v_n = 0, '8: history cannot be edited directly';
  delete from recruitment_events where candidate_id = v_c2;
  get diagnostics v_n = row_count;
  assert v_n = 0, '8: history cannot be deleted directly';
  reset role;

  -- 9. another school's HR sees nothing and cannot touch school A's candidates
  insert into school_feature_flags (school_id, flag_id, enabled) values (sb, v_flag, true);
  set local role authenticated;
  perform set_config('request.jwt.claims', json_build_object('sub', a_other, 'role', 'authenticated')::text, true);
  select count(*) into v_n from recruitment_candidates;
  assert v_n = 0, '9: other school sees no candidates';
  select count(*) into v_n from recruitment_events;
  assert v_n = 0, '9: other school sees no history';
  v_failed := false;
  begin perform move_recruitment_candidate(v_c2, 'withdrawn', null);
  exception when others then get stacked diagnostics v_state = returned_sqlstate; v_failed := (v_state = 'P0002'); end;
  assert v_failed, '9: cross-school move refused';
  v_failed := false;
  begin perform add_recruitment_candidate(v_open, 'Cross School', null, null, null);
  exception when others then get stacked diagnostics v_state = returned_sqlstate; v_failed := (v_state = 'P0002'); end;
  assert v_failed, '9: cross-school add refused';
  reset role;

  -- 10. the opening change was audited by the existing trigger
  assert exists (select 1 from audit_log where table_name = 'recruitment_openings' and record_id = v_open and school_id = sa),
    '10: opening changes are audited';

  -- 11. grants
  assert not has_function_privilege('anon', 'public.save_recruitment_opening(uuid,text,text,text,text,integer,date,text)', 'execute'), '11: anon save';
  assert not has_function_privilege('anon', 'public.add_recruitment_candidate(uuid,text,text,text,text)', 'execute'), '11: anon add';
  assert not has_function_privilege('anon', 'public.move_recruitment_candidate(uuid,text,text)', 'execute'), '11: anon move';
  assert not has_function_privilege('anon', 'public.add_recruitment_note(uuid,text)', 'execute'), '11: anon note';
  assert not has_function_privilege('authenticated', 'public.recruitment_guard()', 'execute'), '11: guard is internal';

  raise notice 'recruitment pipeline behavioural checks: all passed';
end
$$;

rollback;

do $$
begin
  if exists (select 1 from schools where slug in ('rec-test-a', 'rec-test-b'))
     or exists (select 1 from auth.users where email like 'rec-%@example.invalid') then
    raise exception 'LEAK DETECTED: recruitment test fixtures were not rolled back -- fix this test file before trusting it again';
  end if;
end
$$;
