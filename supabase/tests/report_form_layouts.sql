-- Behavioral test for Phase 7.7 (report form designer storage).
-- Rollback-only, synthetic fixtures, real role impersonation (request.jwt.claims GUC), real deployed
-- functions and policies. Same safety model as events_houses_calendar.sql: opens with `begin;`, ends with
-- `rollback;`, and a tripwire in its own transaction fails loudly if any fixture persisted.
-- Run: psql "$SUPABASE_DB_URL" -v ON_ERROR_STOP=1 -f supabase/tests/report_form_layouts.sql
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
  v_flag uuid;
  v_n int;
  v_failed boolean;
  v_state text;
  v_title text;
  v_footer text;
begin
  select id into r_writer from roles where name = 'deputy_principal';
  select id into r_parent from roles where name = 'parent';
  assert r_writer is not null and r_parent is not null, 'fixture roles deputy_principal and parent exist';

  insert into schools (id, name, slug, application_number_prefix) values
    (sa, 'RFL Test School A', 'rfl-test-school-a', 'RFA'),
    (sb, 'RFL Test School B', 'rfl-test-school-b', 'RFB');
  insert into auth.users (id, aud, role, email) values
    (a_writer, 'authenticated', 'authenticated', 'rfl-writer@example.invalid'),
    (a_parent, 'authenticated', 'authenticated', 'rfl-parent@example.invalid'),
    (a_other, 'authenticated', 'authenticated', 'rfl-other@example.invalid');
  insert into school_users (id, school_id, auth_user_id, role_id, full_name, status) values
    (su_writer, sa, a_writer, r_writer, 'RFL Writer', 'active'),
    (su_parent, sa, a_parent, r_parent, 'RFL Parent', 'active'),
    (su_other, sb, a_other, r_writer, 'RFL Other School Writer', 'active');

  select id into v_flag from platform_feature_flags where lower(key) = 'feature.reports.custom_forms';
  assert v_flag is not null, 'flag catalog entry exists';

  -- 1. flag off: the writer is refused with 55000
  set local role authenticated;
  perform set_config('request.jwt.claims', json_build_object('sub', a_writer, 'role', 'authenticated')::text, true);
  v_failed := false;
  begin
    perform save_report_form_layout('Progress Report', null, null, null, null, null);
  exception when others then
    get stacked diagnostics v_state = returned_sqlstate;
    v_failed := (v_state = '55000');
  end;
  reset role;
  assert v_failed, 'flag off: save_report_form_layout refused with 55000';

  insert into school_feature_flags (school_id, flag_id, enabled) values (sa, v_flag, true);

  -- 2. writer saves; blanks become NULL (default wording); values are trimmed
  set local role authenticated;
  perform set_config('request.jwt.claims', json_build_object('sub', a_writer, 'role', 'authenticated')::text, true);
  perform save_report_form_layout('  Progress Report  ', 'Excellence in all things', 'Fees are payable by the 5th.', '', null, 'Guardian');
  select title, footer_note into v_title, v_footer from report_form_layouts where school_id = sa;
  assert v_title = 'Progress Report', 'title trimmed';
  assert v_footer = 'Fees are payable by the 5th.', 'footer saved';
  assert (select class_teacher_label is null and head_teacher_label is null and parent_label = 'Guardian'
            from report_form_layouts where school_id = sa), 'blank labels stored as NULL, set label kept';
  -- saving again updates the same single row
  perform save_report_form_layout('Term Report', null, null, null, null, null);
  reset role;
  select count(*) into v_n from report_form_layouts where school_id = sa;
  assert v_n = 1, 'one row per school after a second save';
  assert (select title = 'Term Report' and subtitle is null and footer_note is null and parent_label is null
            from report_form_layouts where school_id = sa), 'second save replaces every field (clear = default)';

  -- 3. a parent in the same school can read the layout but not change it
  set local role authenticated;
  perform set_config('request.jwt.claims', json_build_object('sub', a_parent, 'role', 'authenticated')::text, true);
  select count(*) into v_n from report_form_layouts;
  assert v_n = 1, 'parent in the school reads the layout';
  v_failed := false;
  begin
    perform save_report_form_layout('Hacked', null, null, null, null, null);
  exception when others then
    get stacked diagnostics v_state = returned_sqlstate;
    v_failed := (v_state = '42501');
  end;
  assert v_failed, 'parent refused with 42501';
  reset role;

  -- 4. another school sees nothing, and its writer cannot write while its own flag is off
  set local role authenticated;
  perform set_config('request.jwt.claims', json_build_object('sub', a_other, 'role', 'authenticated')::text, true);
  select count(*) into v_n from report_form_layouts;
  assert v_n = 0, 'other school sees no layout of school A';
  v_failed := false;
  begin
    perform save_report_form_layout('Other', null, null, null, null, null);
  exception when others then
    get stacked diagnostics v_state = returned_sqlstate;
    v_failed := (v_state = '55000');
  end;
  reset role;
  assert v_failed, 'school without the flag refused with 55000';

  -- 5. validation: too long and control characters
  set local role authenticated;
  perform set_config('request.jwt.claims', json_build_object('sub', a_writer, 'role', 'authenticated')::text, true);
  v_failed := false;
  begin
    perform save_report_form_layout(repeat('x', 61), null, null, null, null, null);
  exception when others then
    get stacked diagnostics v_state = returned_sqlstate;
    v_failed := (v_state = '22023');
  end;
  assert v_failed, 'title over 60 characters refused with 22023';
  v_failed := false;
  begin
    perform save_report_form_layout('Ok', null, 'line' || chr(10) || 'break', null, null, null);
  exception when others then
    get stacked diagnostics v_state = returned_sqlstate;
    v_failed := (v_state = '22023');
  end;
  assert v_failed, 'control character in footer refused with 22023';

  -- 6. no direct writes: RLS gives no insert/update policy
  v_failed := false;
  begin
    insert into report_form_layouts (school_id, title) values (sa, 'Direct');
  exception when others then
    v_failed := true;
  end;
  assert v_failed, 'direct insert is refused';
  update report_form_layouts set title = 'Direct update' where school_id = sa;
  get diagnostics v_n = row_count;
  reset role;
  assert v_n = 0, 'direct update changes nothing';
  assert (select title from report_form_layouts where school_id = sa) = 'Term Report', 'title unchanged by direct update';

  -- 7. flag turned off hides the layout from the school's own parent
  update school_feature_flags set enabled = false where school_id = sa and flag_id = v_flag;
  set local role authenticated;
  perform set_config('request.jwt.claims', json_build_object('sub', a_parent, 'role', 'authenticated')::text, true);
  select count(*) into v_n from report_form_layouts;
  reset role;
  assert v_n = 0, 'flag off hides the layout from the school';

  -- 8. anon cannot execute the function
  assert not has_function_privilege('anon', 'public.save_report_form_layout(text,text,text,text,text,text)', 'execute'), 'anon cannot save the layout';

  raise notice 'report_form_layouts behavioral checks: all passed';
end $$;

rollback;

-- Independent tripwire in its own transaction.
do $$
begin
  if exists (select 1 from schools where slug in ('rfl-test-school-a', 'rfl-test-school-b'))
     or exists (select 1 from auth.users where email like 'rfl-%@example.invalid') then
    raise exception 'LEAK DETECTED: report_form_layouts fixtures were not rolled back';
  end if;
end $$;
