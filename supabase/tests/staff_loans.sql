-- Behavioural test for Phase 7.2 automation (migrations *_staff_loans_ledger AND *_staff_loans_payroll_feed). Rollback-only, synthetic fixtures, real role
-- impersonation, and the REAL generate_payroll_record / approve_payroll_record / mark_payroll_paid. One transaction
-- ending in `rollback;`; a final tripwire fails loudly if any fixture row persisted.
--   psql "$SUPABASE_DB_URL" -v ON_ERROR_STOP=1 -f supabase/tests/staff_loans.sql
begin;

do $$
declare
  sa uuid := gen_random_uuid(); sb uuid := gen_random_uuid();
  u_po uuid := gen_random_uuid(); u_p1 uuid := gen_random_uuid(); u_p2 uuid := gen_random_uuid();
  u_b1 uuid := gen_random_uuid(); u_b2 uuid := gen_random_uuid(); u_b3 uuid := gen_random_uuid();
  u_par uuid := gen_random_uuid(); u_xb uuid := gen_random_uuid();
  su_po uuid := gen_random_uuid(); su_p1 uuid := gen_random_uuid(); su_p2 uuid := gen_random_uuid();
  su_b1 uuid := gen_random_uuid(); su_b2 uuid := gen_random_uuid(); su_b3 uuid := gen_random_uuid();
  su_par uuid := gen_random_uuid(); su_xb uuid := gen_random_uuid();
  r_po uuid; r_pr uuid; r_tea uuid; r_parent uuid; v_flag uuid;
  l1 uuid; l2 uuid; l3 uuid; l4 uuid; l5 uuid;
  rec1 uuid; rec2 uuid; rec3 uuid; rec4 uuid; rec5 uuid; rec6 uuid; rec7 uuid; rec8 uuid; rec9 uuid; rec10 uuid;
  v_res jsonb; v_rec payroll_records%rowtype; v_before payroll_records%rowtype;
  v_n integer; v_failed boolean; v_state text; v_x numeric;
  v_cap numeric; v_expected numeric; v_stat numeric;
begin
  select id into r_po from roles where name = 'payroll_officer';
  select id into r_pr from roles where name = 'principal';
  select id into r_tea from roles where name = 'teacher';
  select id into r_parent from roles where name = 'parent';
  assert r_po is not null and r_pr is not null and r_tea is not null and r_parent is not null, 'seed roles exist';
  assert exists (select 1 from role_permissions where role_id = r_po and permission_key = 'payroll.write' and allowed and school_id is null), 'payroll officer can write payroll';
  assert exists (select 1 from role_permissions where role_id = r_pr and permission_key = 'payroll.approve' and allowed and school_id is null), 'principal can approve payroll';
  assert not exists (select 1 from role_permissions where role_id = r_po and permission_key = 'payroll.approve' and allowed and school_id is null), 'payroll officer cannot approve payroll';

  insert into schools (id, name, slug, application_number_prefix) values (sa, 'Loans Test A', 'loans-test-a', 'LNA'), (sb, 'Loans Test B', 'loans-test-b', 'LNB');
  insert into auth.users (id, aud, role, email) values
    (u_po, 'authenticated', 'authenticated', 'ln-po@example.invalid'), (u_p1, 'authenticated', 'authenticated', 'ln-p1@example.invalid'),
    (u_p2, 'authenticated', 'authenticated', 'ln-p2@example.invalid'), (u_b1, 'authenticated', 'authenticated', 'ln-b1@example.invalid'),
    (u_b2, 'authenticated', 'authenticated', 'ln-b2@example.invalid'), (u_b3, 'authenticated', 'authenticated', 'ln-b3@example.invalid'),
    (u_par, 'authenticated', 'authenticated', 'ln-par@example.invalid'), (u_xb, 'authenticated', 'authenticated', 'ln-xb@example.invalid');
  insert into school_users (id, school_id, auth_user_id, role_id, full_name, status) values
    (su_po, sa, u_po, r_po, 'Ln Payroll Officer', 'active'), (su_p1, sa, u_p1, r_pr, 'Ln Principal 1', 'active'),
    (su_p2, sa, u_p2, r_pr, 'Ln Principal 2', 'active'), (su_b1, sa, u_b1, r_tea, 'Ln Borrower 1', 'active'),
    (su_b2, sa, u_b2, r_tea, 'Ln Borrower 2', 'active'), (su_b3, sa, u_b3, r_tea, 'Ln Borrower 3', 'active'),
    (su_par, sa, u_par, r_parent, 'Ln Parent', 'active'), (su_xb, sb, u_xb, r_tea, 'Ln Other School', 'active');
  select id into v_flag from platform_feature_flags where key = 'feature.hr.staff_loans';
  assert v_flag is not null, 'flag catalog entry exists';
  -- a principal who may also write payroll, so separation of duties can be tested against someone holding both
  insert into role_permissions (role_id, school_id, permission_key, allowed) values (r_pr, sa, 'payroll.write', true);

  -- 1. flag off
  execute 'set local role authenticated';
  perform set_config('request.jwt.claims', json_build_object('sub', u_po, 'role', 'authenticated')::text, true);
  v_failed := false;
  begin perform create_staff_loan(su_b1, 'loan', 30000, 5000, 2026, 3, 'x'); exception when others then get stacked diagnostics v_state = returned_sqlstate; v_failed := (v_state = '55000'); end;
  assert v_failed, '1: flag off refuses with 55000';
  execute 'reset role';
  insert into school_feature_flags (school_id, flag_id, enabled) values (sa, v_flag, true);

  -- 2. creating a loan
  execute 'set local role authenticated';
  perform set_config('request.jwt.claims', json_build_object('sub', u_po, 'role', 'authenticated')::text, true);
  l1 := create_staff_loan(su_b1, 'loan', 30000, 5000, 2026, 3, 'School fees loan');
  assert (select status from staff_loans where id = l1) = 'pending', '2: starts pending';
  v_failed := false; begin perform create_staff_loan(su_b1, 'loan', 1000, 2000, 2026, 3, null); exception when sqlstate '22023' then v_failed := true; end;
  assert v_failed, '2: instalment above principal refused';
  v_failed := false; begin perform create_staff_loan(su_b1, 'loan', 1000.555, 100, 2026, 3, null); exception when sqlstate '22023' then v_failed := true; end;
  assert v_failed, '2: fractional cents refused';
  v_failed := false; begin perform create_staff_loan(su_b1, 'bribe', 1000, 100, 2026, 3, null); exception when sqlstate '22023' then v_failed := true; end;
  assert v_failed, '2: unknown kind refused';
  v_failed := false; begin perform create_staff_loan(su_par, 'loan', 1000, 100, 2026, 3, null); exception when sqlstate '22023' then v_failed := true; end;
  assert v_failed, '2: a parent is not staff';
  v_failed := false; begin perform create_staff_loan(su_xb, 'loan', 1000, 100, 2026, 3, null); exception when sqlstate 'P0002' then v_failed := true; end;
  assert v_failed, '2: another school''s staff member not found';
  perform set_config('request.jwt.claims', json_build_object('sub', u_b1, 'role', 'authenticated')::text, true);
  v_failed := false; begin perform create_staff_loan(su_b1, 'loan', 1000, 100, 2026, 3, null); exception when sqlstate '42501' then v_failed := true; end;
  assert v_failed, '2: a borrower cannot create their own loan';

  -- 3. a pending loan is due nothing; the due calculation WRITES NOTHING to payroll
  perform set_config('request.jwt.claims', json_build_object('sub', u_po, 'role', 'authenticated')::text, true);
  rec1 := (generate_payroll_record(su_b1, 2026::smallint, 4::smallint, 50000, 0, null, null, null)).id;
  select * into v_before from payroll_records where id = rec1;
  assert (staff_loan_due_for_record(rec1) ->> 'total')::numeric = 0, '3: a pending loan is due nothing';

  -- 4. approval: separation of duties and the written agreement
  v_failed := false; begin perform approve_staff_loan(l1, date '2026-02-20'); exception when sqlstate '42501' then v_failed := true; end;
  assert v_failed, '4: a payroll officer cannot approve';
  perform set_config('request.jwt.claims', json_build_object('sub', u_p1, 'role', 'authenticated')::text, true);
  v_failed := false; begin perform approve_staff_loan(l1, null); exception when sqlstate '22023' then v_failed := true; end;
  assert v_failed, '4: the agreement date is required';
  v_failed := false; begin perform approve_staff_loan(l1, current_date + 5); exception when sqlstate '22023' then v_failed := true; end;
  assert v_failed, '4: the agreement cannot be dated in the future';
  l2 := create_staff_loan(su_b1, 'advance', 10000, 10000, 2026, 4, 'created by someone who can also approve');
  v_failed := false; begin perform approve_staff_loan(l2, date '2026-02-20'); exception when sqlstate '42501' then v_failed := true; end;
  assert v_failed, '4: the creator cannot approve their own loan';
  perform set_config('request.jwt.claims', json_build_object('sub', u_po, 'role', 'authenticated')::text, true);
  l3 := create_staff_loan(su_p2, 'loan', 8000, 2000, 2026, 3, 'the borrower is a principal');
  perform set_config('request.jwt.claims', json_build_object('sub', u_p2, 'role', 'authenticated')::text, true);
  v_failed := false; begin perform approve_staff_loan(l3, date '2026-02-20'); exception when sqlstate '42501' then v_failed := true; end;
  assert v_failed, '4: the borrower cannot approve their own loan';
  perform set_config('request.jwt.claims', json_build_object('sub', u_p1, 'role', 'authenticated')::text, true);
  perform approve_staff_loan(l1, date '2026-02-20');
  assert (select status from staff_loans where id = l1) = 'active' and (select agreement_on from staff_loans where id = l1) = date '2026-02-20', '4: approved with its agreement date';
  v_failed := false; begin perform approve_staff_loan(l1, date '2026-02-20'); exception when sqlstate '22023' then v_failed := true; end;
  assert v_failed, '4: cannot approve twice';

  -- 5. what is due, recomputed here from the record itself; and it never writes
  perform set_config('request.jwt.claims', json_build_object('sub', u_po, 'role', 'authenticated')::text, true);
  v_stat := v_before.nssf_employee + v_before.shif + v_before.ahl + v_before.paye;
  v_cap := trunc(greatest(least((v_before.gross_salary * 2 / 3) - v_stat - v_before.other_deductions, (v_before.gross_salary - v_stat - v_before.other_deductions) * 0.5), 0) * 100) / 100;
  v_expected := least(5000, v_cap);
  v_res := staff_loan_due_for_record(rec1);
  assert (v_res ->> 'total')::numeric = v_expected and v_expected > 0, '5: the instalment due, within the legal caps';
  assert (v_res -> 'lines' -> 0 ->> 'loan_id') = l1::text and (v_res -> 'lines' -> 0 ->> 'name') = 'Staff loan repayment', '5: names the loan and the payslip line';
  assert (v_stat + v_expected) <= v_before.gross_salary * 2 / 3 + 0.005, '5: total deductions within two-thirds of wages';
  assert v_expected <= (v_before.gross_salary - v_stat - v_before.other_deductions) * 0.5 + 0.005, '5: the loan is within half of the pay left';
  select * into v_rec from payroll_records where id = rec1;
  assert to_jsonb(v_rec) - 'updated_at' = to_jsonb(v_before) - 'updated_at', '5: working out what is due changed nothing in payroll';
  assert (staff_loan_due_for_record(rec1) = v_res), '5: asking twice gives the same answer';

  -- 6. before the first deduction month nothing is due
  rec3 := (generate_payroll_record(su_b1, 2026::smallint, 2::smallint, 50000, 0, null, null, null)).id;
  assert (staff_loan_due_for_record(rec3) ->> 'total')::numeric = 0, '6: February is before the first deduction month (March)';

  -- 7. the legal caps bind: low wages and large other deductions
  l4 := create_staff_loan(su_b3, 'loan', 30000, 5000, 2026, 3, 'low wage borrower');
  perform set_config('request.jwt.claims', json_build_object('sub', u_p1, 'role', 'authenticated')::text, true);
  perform approve_staff_loan(l4, date '2026-02-20');
  perform set_config('request.jwt.claims', json_build_object('sub', u_po, 'role', 'authenticated')::text, true);
  rec8 := (generate_payroll_record(su_b3, 2026::smallint, 4::smallint, 20000, 9000, 'Co-op shares and rent', null, null)).id;
  select * into v_before from payroll_records where id = rec8;
  v_stat := v_before.nssf_employee + v_before.shif + v_before.ahl + v_before.paye;
  v_cap := trunc(greatest(least((v_before.gross_salary * 2 / 3) - v_stat - v_before.other_deductions, (v_before.gross_salary - v_stat - v_before.other_deductions) * 0.5), 0) * 100) / 100;
  assert v_cap > 0 and v_cap < 5000, '7: fixture really makes the cap bind';
  v_res := staff_loan_due_for_record(rec8);
  assert (v_res ->> 'total')::numeric = v_cap and (v_res ->> 'capped')::boolean = true, '7: the instalment is cut to the cap and flagged';
  assert (v_stat + v_before.other_deductions + (v_res ->> 'total')::numeric) <= v_before.gross_salary * 2 / 3 + 0.005, '7: total deductions never pass two-thirds of wages';
  assert (v_res ->> 'total')::numeric <= (v_before.gross_salary - v_stat - v_before.other_deductions) * 0.5 + 0.005, '7: nor half of the pay left';
  v_res := staff_loan_due_for_record(rec8, 1000);
  assert (v_res ->> 'cap')::numeric >= v_cap, '7: counting 1,000 of the other deductions as loan lines already placed leaves more room';

  -- 7b. the 50% rule is the one that binds: a large instalment against a healthy salary
  l5 := create_staff_loan(su_b2, 'loan', 60000, 30000, 2026, 3, 'large instalment');
  perform set_config('request.jwt.claims', json_build_object('sub', u_p1, 'role', 'authenticated')::text, true);
  perform approve_staff_loan(l5, date '2026-02-20');
  perform set_config('request.jwt.claims', json_build_object('sub', u_po, 'role', 'authenticated')::text, true);
  rec2 := (generate_payroll_record(su_b2, 2026::smallint, 4::smallint, 50000, 0, null, null, null)).id;
  select * into v_before from payroll_records where id = rec2;
  v_stat := v_before.nssf_employee + v_before.shif + v_before.ahl + v_before.paye;
  assert (v_before.gross_salary - v_stat - v_before.other_deductions) * 0.5 < (v_before.gross_salary * 2 / 3) - v_stat - v_before.other_deductions, '7b: fixture really makes the 50% rule the tighter one';
  v_cap := trunc((v_before.gross_salary - v_stat - v_before.other_deductions) * 0.5 * 100) / 100;
  assert v_cap < 30000, '7b: and it is below the instalment';
  v_res := staff_loan_due_for_record(rec2);
  assert (v_res ->> 'total')::numeric = v_cap and (v_res ->> 'capped')::boolean = true, '7b: the instalment is cut to half of the pay left';
  assert (v_res ->> 'total')::numeric <= (v_before.gross_salary - v_stat - v_before.other_deductions) * 0.5, '7b: never more than half of the pay left';

  -- 8. it only works on a draft, and only for payroll staff
  perform set_config('request.jwt.claims', json_build_object('sub', u_p1, 'role', 'authenticated')::text, true);
  perform approve_payroll_record(rec3);
  perform set_config('request.jwt.claims', json_build_object('sub', u_po, 'role', 'authenticated')::text, true);
  v_failed := false; begin perform staff_loan_due_for_record(rec3); exception when sqlstate '22023' then v_failed := true; end;
  assert v_failed, '8: an approved record is not worked out';
  perform set_config('request.jwt.claims', json_build_object('sub', u_b1, 'role', 'authenticated')::text, true);
  v_failed := false; begin perform staff_loan_due_for_record(rec1); exception when sqlstate '42501' then v_failed := true; end;
  assert v_failed, '8: a staff member cannot ask what is due on payroll';

  -- 9. paying off by hand: the last repayment closes the loan, and nothing is ever repaid beyond what was lent
  perform set_config('request.jwt.claims', json_build_object('sub', u_po, 'role', 'authenticated')::text, true);
  v_res := record_staff_loan_repayment(l1, 1000, 'Deducted in the April payroll', 'rep-1');
  assert (v_res ->> 'duplicate')::boolean = false and (v_res ->> 'balance')::numeric = 29000, '9: recorded, balance 29,000';
  v_res := record_staff_loan_repayment(l1, 1000, 'Deducted in the April payroll', 'rep-1');
  assert (v_res ->> 'duplicate')::boolean = true and (select count(*) from staff_loan_entries where loan_id = l1 and client_ref = 'rep-1') = 1, '9: a retry is not recorded twice';
  v_failed := false; begin perform record_staff_loan_repayment(l1, 99999999, null, 'rep-2'); exception when sqlstate '22023' then v_failed := true; end;
  assert v_failed, '9: more than is owed is refused';
  v_failed := false; begin perform record_staff_loan_repayment(l1, 10.555, null, 'rep-3'); exception when sqlstate '22023' then v_failed := true; end;
  assert v_failed, '9: fractional cents refused';
  v_failed := false; begin perform record_staff_loan_repayment(l2, 100, null, 'rep-4'); exception when sqlstate '22023' then v_failed := true; end;
  assert v_failed, '9: a pending loan takes no repayment';
  v_res := staff_loan_due_for_record(rec1);
  assert (v_res ->> 'total')::numeric = v_expected, '9: still due the same instalment while the balance is large';
  perform record_staff_loan_repayment(l1, 28500, 'Cash handed to the bursar', 'rep-5');
  v_res := staff_loan_due_for_record(rec1);
  assert (v_res ->> 'total')::numeric = 500, '9: the last instalment is only what is left';
  perform record_staff_loan_repayment(l1, 500, 'Final cash', 'rep-6');
  assert (select status from staff_loans where id = l1) = 'paid_off' and (select balance from staff_loan_balances where loan_id = l1) = 0, '9: the loan closes at zero';
  assert (staff_loan_due_for_record(rec1) ->> 'total')::numeric = 0, '9: nothing is due once it is paid off';
  execute 'reset role';
  v_failed := false; begin insert into staff_loan_entries (school_id, loan_id, kind, amount) values (sa, l4, 'manual_repayment', 999999); exception when sqlstate '22023' then v_failed := true; end;
  assert v_failed, '9: even the table owner cannot repay more than was lent';
  execute 'set local role authenticated';
  perform set_config('request.jwt.claims', json_build_object('sub', u_po, 'role', 'authenticated')::text, true);

  -- 10. cancel and write off
  perform cancel_staff_loan(l2, 'Staff member withdrew the request');
  assert (select status from staff_loans where id = l2) = 'cancelled', '10: a pending loan can be cancelled';
  perform record_staff_loan_repayment(l4, 100, 'First cash', 'rep-7');
  v_failed := false; begin perform cancel_staff_loan(l4, 'too late'); exception when sqlstate '22023' then v_failed := true; end;
  assert v_failed, '10: a loan with repayments cannot be cancelled';
  v_failed := false; begin perform write_off_staff_loan(l4, 'payroll officer tries'); exception when sqlstate '42501' then v_failed := true; end;
  assert v_failed, '10: a payroll officer cannot write off';
  perform set_config('request.jwt.claims', json_build_object('sub', u_p1, 'role', 'authenticated')::text, true);
  perform approve_staff_loan(l3, date '2026-02-20');
  perform set_config('request.jwt.claims', json_build_object('sub', u_p2, 'role', 'authenticated')::text, true);
  v_failed := false; begin perform write_off_staff_loan(l3, 'writing off my own'); exception when sqlstate '42501' then v_failed := true; end;
  assert v_failed, '10: the borrower cannot write off their own loan';
  perform set_config('request.jwt.claims', json_build_object('sub', u_p1, 'role', 'authenticated')::text, true);
  v_x := write_off_staff_loan(l4, 'Hardship, approved by the board');
  assert v_x = 29900, '10: the write-off is exactly what was left (30,000 minus 100)';
  assert (select status from staff_loans where id = l4) = 'paid_off' and (select balance from staff_loan_balances where loan_id = l4) = 0, '10: and the loan is closed';

  -- 11. append-only
  execute 'reset role';
  v_failed := false; begin update staff_loan_entries set amount = 1 where loan_id = l1; exception when sqlstate '42501' then v_failed := true; end;
  assert v_failed, '11: ledger cannot be edited';
  v_failed := false; begin delete from staff_loan_entries where loan_id = l1; exception when sqlstate '42501' then v_failed := true; end;
  assert v_failed, '11: ledger cannot be deleted';

  -- 12. visibility
  execute 'set local role authenticated';
  perform set_config('request.jwt.claims', json_build_object('sub', u_b1, 'role', 'authenticated')::text, true);
  assert (select count(*) from staff_loans) = 2 and not exists (select 1 from staff_loans where staff_id <> su_b1), '12: a borrower sees only their own loans';
  assert (select count(*) from staff_loan_entries) > 0 and not exists (select 1 from staff_loan_entries where loan_id = l4), '12: and only their own ledger';
  perform set_config('request.jwt.claims', json_build_object('sub', u_b2, 'role', 'authenticated')::text, true);
  assert (select count(*) from staff_loans) = 1 and not exists (select 1 from staff_loans where staff_id <> su_b2), '12: another borrower sees only their own';
  perform set_config('request.jwt.claims', json_build_object('sub', u_po, 'role', 'authenticated')::text, true);
  assert (select count(*) from staff_loans) = 5, '12: payroll staff see them all';
  perform set_config('request.jwt.claims', json_build_object('sub', u_par, 'role', 'authenticated')::text, true);
  assert (select count(*) from staff_loans) = 0 and (select count(*) from staff_loan_balances) = 0, '12: a parent sees none';
  perform set_config('request.jwt.claims', json_build_object('sub', u_xb, 'role', 'authenticated')::text, true);
  assert (select count(*) from staff_loans) = 0, '12: another school sees none';
  perform set_config('request.jwt.claims', json_build_object('sub', u_po, 'role', 'authenticated')::text, true);
  v_failed := false; begin insert into staff_loans (school_id, staff_id, kind, principal, installment, first_year, first_month) values (sa, su_b1, 'loan', 1, 1, 2026, 1);
  exception when others then get stacked diagnostics v_state = returned_sqlstate; v_failed := (v_state = '42501'); end;
  assert v_failed, '12: direct writes are refused';
  execute 'reset role';

  -- 13. the due calculation is read-only, and everything is locked down
  assert (select provolatile from pg_proc where oid = 'public.staff_loan_due_for_record(uuid,numeric)'::regprocedure) = 's', '13: the due calculation is STABLE (read-only)';
  assert not has_function_privilege('anon', 'public.create_staff_loan(uuid,text,numeric,numeric,integer,integer,text)', 'execute'), '13: anon create';
  assert not has_function_privilege('anon', 'public.staff_loan_due_for_record(uuid,numeric)', 'execute'), '13: anon due';
  assert not has_function_privilege('authenticated', 'public.staff_loans_guard(text)', 'execute'), '13: guard is internal';
  assert exists (select 1 from audit_log where table_name = 'staff_loans' and record_id = l1 and school_id = sa), '13: loan changes are audited';

  raise notice 'staff loans behavioural checks: all passed';
end
$$;

rollback;

do $$
begin
  if exists (select 1 from schools where slug in ('loans-test-a', 'loans-test-b'))
     or exists (select 1 from auth.users where email like 'ln-%@example.invalid') then
    raise exception 'LEAK DETECTED: staff loans test fixtures were not rolled back -- fix this test file before trusting it again';
  end if;
end
$$;
