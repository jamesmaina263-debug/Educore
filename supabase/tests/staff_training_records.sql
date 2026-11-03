-- Behavioral test for Phase 7.3 (staff training records + expiry roll-up).
-- Rollback-only, synthetic fixtures, real role impersonation (request.jwt.claims GUC), real deployed
-- functions and policies. Same safety model as events_houses_calendar.sql: opens with `begin;`, ends with
-- `rollback;`, and a tripwire in its own transaction fails loudly if any fixture persisted.
-- Run: psql "$SUPABASE_DB_URL" -v ON_ERROR_STOP=1 -f supabase/tests/staff_training_records.sql
begin;

do $$
declare
  sa uuid := gen_random_uuid();
  sb uuid := gen_random_uuid();
  r_mgr uuid;
  r_parent uuid;
  a_mgr uuid := gen_random_uuid();
  a_self uuid := gen_random_uuid();
  a_peer uuid := gen_random_uuid();
  a_other uuid := gen_random_uuid();
  su_mgr uuid := gen_random_uuid();
  su_self uuid := gen_random_uuid();
  su_peer uuid := gen_random_uuid();
  su_other uuid := gen_random_uuid();
  v_flag uuid;
  v_t_self uuid;
  v_t_peer uuid;
  v_today date := (now() at time zone 'Africa/Nairobi')::date;
  v_n int;
  v_failed boolean;
  v_state text;
begin
  select id into r_mgr from roles where name = 'deputy_principal';
  select id into r_parent from roles where name = 'parent';
  assert r_mgr is not null and r_parent is not null, 'fixture roles deputy_principal and parent exist';

  insert into schools (id, name, slug, application_number_prefix) values
    (sa, 'STR Test School A', 'str-test-school-a', 'STA'),
    (sb, 'STR Test School B', 'str-test-school-b', 'STB');
  insert into auth.users (id, aud, role, email) values
    (a_mgr, 'authenticated', 'authenticated', 'str-mgr@example.invalid'),
    (a_self, 'authenticated', 'authenticated', 'str-self@example.invalid'),
    (a_peer, 'authenticated', 'authenticated', 'str-peer@example.invalid'),
    (a_other, 'authenticated', 'authenticated', 'str-other@example.invalid');
  insert into school_users (id, school_id, auth_user_id, role_id, full_name, status, contract_type, contract_end_date) values
    (su_mgr, sa, a_mgr, r_mgr, 'STR Manager', 'active', null, null),
    (su_self, sa, a_self, r_parent, 'STR Self', 'active', 'contract', v_today + 30),
    (su_peer, sa, a_peer, r_parent, 'STR Peer', 'active', 'contract', v_today + 400),
    (su_other, sb, a_other, r_mgr, 'STR Other School Manager', 'active', null, null);
  insert into staff_qualifications (school_id, staff_id, qualification_name, expiry_date)
    values (sa, su_self, 'STR First Aid', v_today + 10);

  select id into v_flag from platform_feature_flags where lower(key) = 'feature.hr.staff_training';
  assert v_flag is not null, 'flag catalog entry exists';

  -- 1. flag off: the manager is refused with 55000
  set local role authenticated;
  perform set_config('request.jwt.claims', json_build_object('sub', a_mgr, 'role', 'authenticated')::text, true);
  v_failed := false;
  begin
    perform save_staff_training_record(null, su_self, 'T', null, 'cpd', 'planned', v_today, null, null, null, null, null);
  exception when others then
    get stacked diagnostics v_state = returned_sqlstate;
    v_failed := (v_state = '55000');
  end;
  assert v_failed, 'flag off: save refused with 55000';
  v_failed := false;
  begin
    perform * from staff_expiry_overview(90);
  exception when others then
    get stacked diagnostics v_state = returned_sqlstate;
    v_failed := (v_state = '55000');
  end;
  reset role;
  assert v_failed, 'flag off: overview refused with 55000';

  insert into school_feature_flags (school_id, flag_id, enabled) values (sa, v_flag, true);

  -- 2. manager creates records for two staff members, one completed with an expiry
  set local role authenticated;
  perform set_config('request.jwt.claims', json_build_object('sub', a_mgr, 'role', 'authenticated')::text, true);
  v_t_self := save_staff_training_record(null, su_self, 'Safeguarding refresher', 'Provider', 'safeguarding', 'completed',
                                         v_today - 20, v_today - 20, 4.5, v_today + 20, null, 'notes');
  v_t_peer := save_staff_training_record(null, su_peer, 'Peer training', null, 'cpd', 'planned', v_today + 5, null, null, null, null, null);
  reset role;
  assert v_t_self is not null and v_t_peer is not null, 'manager created records';

  -- 3. invalid details and cross-school / bad references are refused
  set local role authenticated;
  perform set_config('request.jwt.claims', json_build_object('sub', a_mgr, 'role', 'authenticated')::text, true);
  v_failed := false;
  begin
    perform save_staff_training_record(null, su_self, 'Bad dates', null, 'cpd', 'planned', v_today, v_today - 1, null, null, null, null);
  exception when others then
    get stacked diagnostics v_state = returned_sqlstate;
    v_failed := (v_state = '22023');
  end;
  assert v_failed, 'end before start refused with 22023';
  v_failed := false;
  begin
    perform save_staff_training_record(null, su_self, 'Bad status', null, 'cpd', 'cancelled', v_today, null, null, null, null, null);
  exception when others then
    get stacked diagnostics v_state = returned_sqlstate;
    v_failed := (v_state = '22023');
  end;
  assert v_failed, 'cannot create directly as cancelled';
  v_failed := false;
  begin
    perform save_staff_training_record(null, su_other, 'Cross school', null, 'cpd', 'planned', v_today, null, null, null, null, null);
  exception when others then
    get stacked diagnostics v_state = returned_sqlstate;
    v_failed := (v_state = 'P0002');
  end;
  assert v_failed, 'other-school staff member refused with P0002';
  v_failed := false;
  begin
    perform save_staff_training_record(null, su_self, 'Bad doc', null, 'cpd', 'planned', v_today, null, null, null, gen_random_uuid(), null);
  exception when others then
    get stacked diagnostics v_state = returned_sqlstate;
    v_failed := (v_state = 'P0002');
  end;
  assert v_failed, 'unknown certificate document refused with P0002';
  -- no direct writes
  v_failed := false;
  begin
    insert into staff_training_records (school_id, staff_id, title, start_date) values (sa, su_self, 'Direct', v_today);
  exception when others then
    v_failed := true;
  end;
  reset role;
  assert v_failed, 'direct insert is refused';

  -- 4. visibility: self sees own, not peer's; a peer cannot call write or overview functions
  set local role authenticated;
  perform set_config('request.jwt.claims', json_build_object('sub', a_self, 'role', 'authenticated')::text, true);
  select count(*) into v_n from staff_training_records where id = v_t_self;
  assert v_n = 1, 'staff member sees their own record';
  select count(*) into v_n from staff_training_records where id = v_t_peer;
  assert v_n = 0, 'staff member does not see a colleague''s record';
  v_failed := false;
  begin
    perform save_staff_training_record(null, su_self, 'Self add', null, 'cpd', 'planned', v_today, null, null, null, null, null);
  exception when others then
    get stacked diagnostics v_state = returned_sqlstate;
    v_failed := (v_state = '42501');
  end;
  assert v_failed, 'self cannot write (42501)';
  v_failed := false;
  begin
    perform * from staff_expiry_overview(90);
  exception when others then
    get stacked diagnostics v_state = returned_sqlstate;
    v_failed := (v_state = '42501');
  end;
  reset role;
  assert v_failed, 'self cannot read the roll-up (42501)';

  -- 5. roll-up: manager sees the contract, qualification and training due within 90 days, not the far contract
  set local role authenticated;
  perform set_config('request.jwt.claims', json_build_object('sub', a_mgr, 'role', 'authenticated')::text, true);
  select count(*) into v_n from staff_expiry_overview(90) where kind = 'contract' and staff_id = su_self and days_left = 30;
  assert v_n = 1, 'contract ending in 30 days is listed';
  select count(*) into v_n from staff_expiry_overview(90) where kind = 'contract' and staff_id = su_peer;
  assert v_n = 0, 'contract ending in 400 days is not listed';
  select count(*) into v_n from staff_expiry_overview(90) where kind = 'qualification' and staff_id = su_self and days_left = 10;
  assert v_n = 1, 'qualification expiring in 10 days is listed';
  select count(*) into v_n from staff_expiry_overview(90) where kind = 'training' and staff_id = su_self and days_left = 20;
  assert v_n = 1, 'completed training expiring in 20 days is listed';
  select count(*) into v_n from staff_expiry_overview(90) where kind = 'training' and staff_id = su_peer;
  assert v_n = 0, 'planned training without expiry is not listed';
  reset role;

  -- 6. tenant isolation, even with the flag on for school B
  insert into school_feature_flags (school_id, flag_id, enabled) values (sb, v_flag, true);
  set local role authenticated;
  perform set_config('request.jwt.claims', json_build_object('sub', a_other, 'role', 'authenticated')::text, true);
  select count(*) into v_n from staff_training_records where school_id = sa;
  assert v_n = 0, 'other school cannot read records';
  select count(*) into v_n from staff_expiry_overview(365);
  assert v_n = 0, 'other school roll-up shows nothing of school A';
  v_failed := false;
  begin
    perform cancel_staff_training_record(v_t_self);
  exception when others then
    get stacked diagnostics v_state = returned_sqlstate;
    v_failed := (v_state = 'P0002');
  end;
  reset role;
  assert v_failed, 'other school cannot cancel a record it does not own';

  -- 7. cancel keeps the row; cancelled records cannot be edited or cancelled again and leave the roll-up
  set local role authenticated;
  perform set_config('request.jwt.claims', json_build_object('sub', a_mgr, 'role', 'authenticated')::text, true);
  perform cancel_staff_training_record(v_t_self);
  v_failed := false;
  begin
    perform save_staff_training_record(v_t_self, su_self, 'Edit', null, 'cpd', 'completed', v_today, null, null, null, null, null);
  exception when others then
    get stacked diagnostics v_state = returned_sqlstate;
    v_failed := (v_state = 'P0002');
  end;
  assert v_failed, 'cancelled record cannot be edited';
  select count(*) into v_n from staff_expiry_overview(90) where kind = 'training' and staff_id = su_self;
  reset role;
  assert v_n = 0, 'cancelled training leaves the roll-up';
  select count(*) into v_n from staff_training_records where id = v_t_self and status = 'cancelled';
  assert v_n = 1, 'cancelled record is kept';

  -- 8. anon cannot execute the functions
  assert not has_function_privilege('anon', 'public.save_staff_training_record(uuid,uuid,text,text,text,text,date,date,numeric,date,uuid,text)', 'execute'), 'anon cannot save';
  assert not has_function_privilege('anon', 'public.cancel_staff_training_record(uuid)', 'execute'), 'anon cannot cancel';
  assert not has_function_privilege('anon', 'public.staff_expiry_overview(int)', 'execute'), 'anon cannot read roll-up';

  raise notice 'staff_training_records behavioral checks: all passed';
end $$;

rollback;

-- Independent tripwire in its own transaction.
do $$
begin
  if exists (select 1 from schools where slug in ('str-test-school-a', 'str-test-school-b'))
     or exists (select 1 from auth.users where email like 'str-%@example.invalid') then
    raise exception 'LEAK DETECTED: staff_training_records fixtures were not rolled back';
  end if;
end $$;
