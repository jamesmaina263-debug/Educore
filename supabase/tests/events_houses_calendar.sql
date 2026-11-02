-- Behavioral test for Phase 8.6 (events calendar + competition houses).
-- Rollback-only, synthetic fixtures, real role impersonation (request.jwt.claims GUC), real deployed
-- functions and policies. Same safety model as scheme_of_work_rls.sql / scheduled_fee_reminders.sql:
-- opens with `begin;`, ends with `rollback;`, and a tripwire in its own transaction fails loudly if any
-- fixture persisted. Run: psql "$SUPABASE_DB_URL" -v ON_ERROR_STOP=1 -f supabase/tests/events_houses_calendar.sql
begin;

do $$
declare
  sa uuid := gen_random_uuid();
  sb uuid := gen_random_uuid();
  r_writer uuid;
  r_parent uuid;
  a_writer uuid := gen_random_uuid();
  a_parent uuid := gen_random_uuid();
  a_other uuid := gen_random_uuid();
  su_writer uuid := gen_random_uuid();
  su_parent uuid := gen_random_uuid();
  su_other uuid := gen_random_uuid();
  st_a uuid := gen_random_uuid();
  st_b uuid := gen_random_uuid();
  v_flag uuid;
  v_house uuid;
  v_house_b uuid := gen_random_uuid();
  v_ev_all uuid;
  v_ev_staff uuid;
  v_n int;
  v_failed boolean;
  v_state text;
begin
  select id into r_writer from roles where name = 'deputy_principal';
  select id into r_parent from roles where name = 'parent';
  assert r_writer is not null and r_parent is not null, 'fixture roles deputy_principal and parent exist';

  insert into schools (id, name, slug, application_number_prefix) values
    (sa, 'EHC Test School A', 'ehc-test-school-a', 'EHA'),
    (sb, 'EHC Test School B', 'ehc-test-school-b', 'EHB');
  insert into auth.users (id, aud, role, email) values
    (a_writer, 'authenticated', 'authenticated', 'ehc-writer@example.invalid'),
    (a_parent, 'authenticated', 'authenticated', 'ehc-parent@example.invalid'),
    (a_other, 'authenticated', 'authenticated', 'ehc-other@example.invalid');
  insert into school_users (id, school_id, auth_user_id, role_id, full_name, status) values
    (su_writer, sa, a_writer, r_writer, 'EHC Writer', 'active'),
    (su_parent, sa, a_parent, r_parent, 'EHC Parent', 'active'),
    (su_other, sb, a_other, r_writer, 'EHC Other School Writer', 'active');
  insert into students (id, school_id, first_name, last_name, date_of_birth, gender, status) values
    (st_a, sa, 'Ann', 'Fx', date '2012-01-01', 'female', 'approved'),
    (st_b, sb, 'Bob', 'Fx', date '2012-01-02', 'male', 'approved');
  -- a house that belongs to school B, to test cross-school refusal
  insert into school_houses (id, school_id, name) values (v_house_b, sb, 'Other School House');

  select id into v_flag from platform_feature_flags where lower(key) = 'feature.school.events_calendar';
  assert v_flag is not null, 'flag catalog entry exists';

  -- 1. flag off: the writer is refused with 55000
  set local role authenticated;
  perform set_config('request.jwt.claims', json_build_object('sub', a_writer, 'role', 'authenticated')::text, true);
  v_failed := false;
  begin
    perform save_school_house(null, 'Red', '#ff0000', 'active');
  exception when others then
    get stacked diagnostics v_state = returned_sqlstate;
    v_failed := (v_state = '55000');
  end;
  reset role;
  assert v_failed, 'flag off: save_school_house refused with 55000';

  insert into school_feature_flags (school_id, flag_id, enabled) values (sa, v_flag, true);

  -- 2. writer creates a house, an everyone event tied to it, and a staff-only event
  set local role authenticated;
  perform set_config('request.jwt.claims', json_build_object('sub', a_writer, 'role', 'authenticated')::text, true);
  v_house := save_school_house(null, 'Red', '#ff0000', 'active');
  v_ev_all := save_school_event(null, 'Sports Day', 'Annual', 'sports', date '2026-11-20', date '2026-11-20',
                                time '08:00', time '16:00', 'Field', v_house, 'everyone');
  v_ev_staff := save_school_event(null, 'Staff meeting', null, 'meeting', date '2026-11-21', date '2026-11-21',
                                  null, null, null, null, 'staff_only');
  perform assign_student_house(st_a, v_house);
  select count(*) into v_n from student_house_memberships where student_id = st_a and house_id = v_house;
  reset role;
  assert v_ev_all is not null and v_ev_staff is not null and v_house is not null, 'writer created house and events';
  assert v_n = 1, 'learner assigned to house';

  -- 3. writer cannot attach another school's house, nor assign another school's learner
  set local role authenticated;
  perform set_config('request.jwt.claims', json_build_object('sub', a_writer, 'role', 'authenticated')::text, true);
  v_failed := false;
  begin
    perform save_school_event(null, 'Bad', null, 'other', date '2026-11-22', date '2026-11-22', null, null, null, v_house_b, 'everyone');
  exception when others then
    get stacked diagnostics v_state = returned_sqlstate;
    v_failed := (v_state = 'P0002');
  end;
  assert v_failed, 'cross-school house refused on event';
  v_failed := false;
  begin
    perform assign_student_house(st_b, v_house);
  exception when others then
    get stacked diagnostics v_state = returned_sqlstate;
    v_failed := (v_state = 'P0002');
  end;
  assert v_failed, 'cross-school learner refused';
  -- invalid details refused (end before start)
  v_failed := false;
  begin
    perform save_school_event(null, 'Bad dates', null, 'other', date '2026-11-23', date '2026-11-22', null, null, null, null, 'everyone');
  exception when others then
    get stacked diagnostics v_state = returned_sqlstate;
    v_failed := (v_state = '22023');
  end;
  assert v_failed, 'end before start refused with 22023';
  -- no direct writes: RLS gives no insert policy
  v_failed := false;
  begin
    insert into school_events (school_id, title, starts_on, ends_on) values (sa, 'Direct', date '2026-11-24', date '2026-11-24');
  exception when others then
    v_failed := true;
  end;
  reset role;
  assert v_failed, 'direct insert into school_events is refused';

  -- 4. parent: sees the everyone event, not the staff-only one, cannot write, cannot see memberships
  set local role authenticated;
  perform set_config('request.jwt.claims', json_build_object('sub', a_parent, 'role', 'authenticated')::text, true);
  select count(*) into v_n from school_events where id = v_ev_all;
  assert v_n = 1, 'parent sees an everyone event';
  select count(*) into v_n from school_events where id = v_ev_staff;
  assert v_n = 0, 'parent does not see a staff-only event';
  select count(*) into v_n from student_house_memberships;
  assert v_n = 0, 'parent cannot read house memberships';
  v_failed := false;
  begin
    perform save_school_event(null, 'Nope', null, 'other', date '2026-11-25', date '2026-11-25', null, null, null, null, 'everyone');
  exception when others then
    get stacked diagnostics v_state = returned_sqlstate;
    v_failed := (v_state = '42501');
  end;
  reset role;
  assert v_failed, 'parent refused with 42501';

  -- 5. tenant isolation, even with the flag on for school B
  insert into school_feature_flags (school_id, flag_id, enabled) values (sb, v_flag, true);
  set local role authenticated;
  perform set_config('request.jwt.claims', json_build_object('sub', a_other, 'role', 'authenticated')::text, true);
  select count(*) into v_n from school_events where school_id = sa;
  assert v_n = 0, 'other school cannot read events';
  select count(*) into v_n from school_houses where school_id = sa;
  assert v_n = 0, 'other school cannot read houses';
  select count(*) into v_n from student_house_memberships where school_id = sa;
  assert v_n = 0, 'other school cannot read memberships';
  v_failed := false;
  begin
    perform cancel_school_event(v_ev_all, 'x');
  exception when others then
    get stacked diagnostics v_state = returned_sqlstate;
    v_failed := (v_state = 'P0002');
  end;
  reset role;
  assert v_failed, 'other school cannot cancel an event it does not own';

  -- 6. cancel keeps the row; cancelled events cannot be edited or cancelled again
  set local role authenticated;
  perform set_config('request.jwt.claims', json_build_object('sub', a_writer, 'role', 'authenticated')::text, true);
  perform cancel_school_event(v_ev_all, 'Rain');
  v_failed := false;
  begin
    perform save_school_event(v_ev_all, 'Edit', null, 'sports', date '2026-11-20', date '2026-11-20', null, null, null, null, 'everyone');
  exception when others then
    get stacked diagnostics v_state = returned_sqlstate;
    v_failed := (v_state = 'P0002');
  end;
  reset role;
  assert v_failed, 'cancelled event cannot be edited';
  select count(*) into v_n from school_events where id = v_ev_all and status = 'cancelled' and cancel_reason = 'Rain';
  assert v_n = 1, 'cancelled event is kept with its reason';

  -- 7. removing a learner from a house
  set local role authenticated;
  perform set_config('request.jwt.claims', json_build_object('sub', a_writer, 'role', 'authenticated')::text, true);
  perform assign_student_house(st_a, null);
  reset role;
  select count(*) into v_n from student_house_memberships where student_id = st_a;
  assert v_n = 0, 'learner removed from house';

  -- 8. anon cannot execute the functions
  assert not has_function_privilege('anon', 'public.save_school_event(uuid,text,text,text,date,date,time,time,text,uuid,text)', 'execute'), 'anon cannot save events';
  assert not has_function_privilege('anon', 'public.save_school_house(uuid,text,text,text)', 'execute'), 'anon cannot save houses';
  assert not has_function_privilege('anon', 'public.assign_student_house(uuid,uuid)', 'execute'), 'anon cannot assign houses';
  assert not has_function_privilege('anon', 'public.cancel_school_event(uuid,text)', 'execute'), 'anon cannot cancel events';

  raise notice 'events_houses_calendar behavioral checks: all passed';
end $$;

rollback;

-- Independent tripwire in its own transaction.
do $$
begin
  if exists (select 1 from schools where slug in ('ehc-test-school-a', 'ehc-test-school-b'))
     or exists (select 1 from auth.users where email like 'ehc-%@example.invalid') then
    raise exception 'LEAK DETECTED: events_houses_calendar fixtures were not rolled back';
  end if;
end $$;
