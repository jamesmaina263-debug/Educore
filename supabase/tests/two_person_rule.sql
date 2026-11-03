-- Behavioural test for WP 4.2 (migration *_two_person_rule). Rollback-only, synthetic fixtures, real role
-- The functions are SECURITY DEFINER and read auth.uid() from request.jwt.claims, so the test impersonates by claims only
-- (no role switch), which also lets it read the tables without RLS hiding rows.
-- impersonation (request.jwt.claims). Needs the migration already deployed.
--   psql "$SUPABASE_DB_URL" -v ON_ERROR_STOP=1 -f supabase/tests/two_person_rule.sql
begin;

do $$
declare
  sa uuid := gen_random_uuid();
  r_parent uuid;
  a1 uuid := gen_random_uuid(); a2 uuid := gen_random_uuid(); a3 uuid := gen_random_uuid();
  su1 uuid := gen_random_uuid(); su2 uuid := gen_random_uuid(); su3 uuid := gen_random_uuid();
  v_flag uuid; e1 uuid; e2 uuid; e3 uuid; p1 uuid; v_failed boolean; v_msg text; v_self boolean;
begin
  select id into r_parent from roles where name = 'parent';
  assert r_parent is not null, '0: parent role exists';
  insert into schools (id, name, slug, application_number_prefix) values (sa, 'TPR Test School', 'tpr-test-school', 'TPR');
  insert into auth.users (id, aud, role, email) values
    (a1, 'authenticated', 'authenticated', 'tpr-1@example.invalid'),
    (a2, 'authenticated', 'authenticated', 'tpr-2@example.invalid'),
    (a3, 'authenticated', 'authenticated', 'tpr-3@example.invalid');
  insert into school_users (id, school_id, auth_user_id, role_id, full_name, status) values
    (su1, sa, a1, r_parent, 'TPR One', 'active'), (su2, sa, a2, r_parent, 'TPR Two', 'active'), (su3, sa, a3, r_parent, 'TPR Three', 'active');
  -- Permissions by override so the test does not depend on default role grants.
  insert into user_permission_overrides (school_id, school_user_id, permission_key, allowed)
  select sa, u, k, true
    from (values (su1), (su2)) x(u),
         (values ('finance.write'), ('expenses.approve'), ('payroll.write'), ('payroll.approve')) y(k);
  insert into user_permission_overrides (school_id, school_user_id, permission_key, allowed)
  values (sa, su3, 'finance.write', true);

  select id into v_flag from platform_feature_flags where key = 'feature.controls.two_person';
  assert v_flag is not null, '1: flag exists';
  assert not exists (select 1 from school_feature_flags where flag_id = v_flag and enabled and school_id = sa), '1: off for the fixture school';
  assert not has_function_privilege('authenticated', 'public.two_person_other_approver_exists(uuid,uuid,text)', 'execute'), '1: helper not callable by clients';
  assert not has_function_privilege('anon', 'public.two_person_other_approver_exists(uuid,uuid,text)', 'execute'), '1: helper not callable by anon';

  -- 2. FLAG OFF: behaviour as before: an approver's own expense auto-approves; self-approval of a pending one works.
  perform set_config('request.jwt.claims', json_build_object('sub', a1, 'role', 'authenticated')::text, true);
  e1 := raise_expense('general', 'Vendor', 100, null, null);
  assert (select status from expenses where id = e1) = 'approved', '2: flag off, approver own expense auto-approves';
  insert into expenses (school_id, category, vendor, amount, status, requested_by) values (sa, 'general', 'V', 50, 'pending', su1) returning id into e2;
  perform set_config('request.jwt.claims', json_build_object('sub', a1, 'role', 'authenticated')::text, true);
  perform approve_expense(e2);
  assert (select status from expenses where id = e2) = 'approved', '2: flag off, self-approval allowed';

  -- 3. FLAG ON.
  insert into school_feature_flags (school_id, flag_id, enabled) values (sa, v_flag, true);
  perform set_config('request.jwt.claims', json_build_object('sub', a1, 'role', 'authenticated')::text, true);
  e1 := raise_expense('general', 'Vendor', 100, null, null);
  assert (select status from expenses where id = e1) = 'pending', '3: approver own expense stays pending when another approver exists';
  v_failed := false;
  begin perform approve_expense(e1); exception when others then v_failed := true; get stacked diagnostics v_msg = message_text; end;
  assert v_failed and v_msg like 'You raised this expense%', '3: self-approval refused';
  perform set_config('request.jwt.claims', json_build_object('sub', a2, 'role', 'authenticated')::text, true);
  perform approve_expense(e1);
  assert (select status from expenses where id = e1) = 'approved' and (select approved_by from expenses where id = e1) = su2, '3: another approver can approve';
  select (new_data->>'self_approved')::boolean into v_self from audit_log where record_id = e1 and action = 'approve' order by created_at desc limit 1;
  assert v_self = false, '3: audit shows two-person approval';

  -- 4. FLAG ON, expense raised by a non-approver is pending and any approver can approve.
  perform set_config('request.jwt.claims', json_build_object('sub', a3, 'role', 'authenticated')::text, true);
  e3 := raise_expense('general', 'Vendor', 70, null, null);
  assert (select status from expenses where id = e3) = 'pending', '4: non-approver expense pending';
  perform set_config('request.jwt.claims', json_build_object('sub', a1, 'role', 'authenticated')::text, true);
  perform approve_expense(e3);
  assert (select status from expenses where id = e3) = 'approved', '4: approver approves it';

  -- 5. FLAG ON but the requester is the ONLY approver: still allowed, flagged in the audit log.
  delete from user_permission_overrides where school_user_id = su2 and permission_key in ('expenses.approve', 'payroll.approve');
  perform set_config('request.jwt.claims', json_build_object('sub', a1, 'role', 'authenticated')::text, true);
  e1 := raise_expense('general', 'Solo', 20, null, null);
  assert (select status from expenses where id = e1) = 'approved', '5: sole approver keeps working';
  insert into expenses (school_id, category, vendor, amount, status, requested_by) values (sa, 'general', 'V', 30, 'pending', su1) returning id into e2;
  perform set_config('request.jwt.claims', json_build_object('sub', a1, 'role', 'authenticated')::text, true);
  perform approve_expense(e2);
  select (new_data->>'self_approved')::boolean into v_self from audit_log where record_id = e2 and action = 'approve' order by created_at desc limit 1;
  assert v_self = true, '5: sole-approver self approval is flagged in the audit log';
  insert into user_permission_overrides (school_id, school_user_id, permission_key, allowed)
  values (sa, su2, 'expenses.approve', true), (sa, su2, 'payroll.approve', true);

  -- 6. Payroll: generator cannot approve own record when another payroll approver exists (flag on).
  perform set_config('request.jwt.claims', json_build_object('sub', a1, 'role', 'authenticated')::text, true);
  p1 := (generate_payroll_record(su3, 2026::smallint, 10::smallint, 50000)).id;
  v_failed := false;
  begin perform approve_payroll_record(p1); exception when others then v_failed := true; get stacked diagnostics v_msg = message_text; end;
  assert v_failed and v_msg like 'You generated this payroll record%', '6: payroll self-approval refused';
  perform set_config('request.jwt.claims', json_build_object('sub', a2, 'role', 'authenticated')::text, true);
  perform approve_payroll_record(p1);
  assert (select status from payroll_records where id = p1) = 'approved', '6: another approver approves payroll';

  -- 7. Payroll with the flag off: generator can approve.
  update school_feature_flags set enabled = false where school_id = sa and flag_id = v_flag;
  perform set_config('request.jwt.claims', json_build_object('sub', a1, 'role', 'authenticated')::text, true);
  p1 := (generate_payroll_record(su2, 2026::smallint, 10::smallint, 40000)).id;
  perform approve_payroll_record(p1);
  assert (select status from payroll_records where id = p1) = 'approved', '7: flag off, payroll self-approval allowed';

  raise notice 'two_person_rule behavioral checks: all passed';
end $$;

rollback;

do $$
begin
  if exists (select 1 from schools where slug = 'tpr-test-school') or exists (select 1 from auth.users where email like 'tpr-%@example.invalid') then
    raise exception 'LEAK DETECTED: two_person_rule fixtures were not rolled back';
  end if;
end $$;
