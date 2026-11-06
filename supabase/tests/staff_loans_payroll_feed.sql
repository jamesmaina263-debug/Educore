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

  -- 3. a pending loan does nothing, and a record with no loans is untouched
  perform set_config('request.jwt.claims', json_build_object('sub', u_po, 'role', 'authenticated')::text, true);
  rec1 := (generate_payroll_record(su_b1, 2026::smallint, 4::smallint, 50000, 0, null, null, null)).id;
  select * into v_before from payroll_records where id = rec1;
  v_res := apply_staff_loans_to_draft(rec1);
  assert (v_res ->> 'total')::numeric = 0, '3: a pending loan deducts nothing';
  select * into v_rec from payroll_records where id = rec1;
  assert to_jsonb(v_rec) - 'updated_at' = to_jsonb(v_before) - 'updated_at', '3: the payroll record is unchanged';
  rec2 := (generate_payroll_record(su_b2, 2026::smallint, 4::smallint, 50000, 0, null, null, null)).id;
  select * into v_before from payroll_records where id = rec2;
  perform apply_staff_loans_to_draft(rec2);
  select * into v_rec from payroll_records where id = rec2;
  assert to_jsonb(v_rec) - 'updated_at' = to_jsonb(v_before) - 'updated_at', '3: a staff member with no loan is untouched';

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

  -- 5. the feed: loan 1 (instalment 5,000) onto the April draft. The cap is recomputed here from the record itself.
  perform set_config('request.jwt.claims', json_build_object('sub', u_po, 'role', 'authenticated')::text, true);
  select * into v_before from payroll_records where id = rec1;
  v_stat := v_before.nssf_employee + v_before.shif + v_before.ahl + v_before.paye;
  v_cap := trunc(greatest(least((v_before.gross_salary * 2 / 3) - v_stat - v_before.other_deductions, (v_before.gross_salary - v_stat - v_before.other_deductions) * 0.5), 0) * 100) / 100;
  v_expected := least(5000, v_cap);
  v_res := apply_staff_loans_to_draft(rec1);
  assert (v_res ->> 'total')::numeric = v_expected and v_expected > 0, '5: the instalment due (within the legal caps)';
  select * into v_rec from payroll_records where id = rec1;
  assert v_rec.other_deductions = v_before.other_deductions + v_expected, '5: other deductions went up by exactly the instalment';
  assert v_rec.net_pay = v_before.net_pay - v_expected, '5: net pay went down by exactly the instalment';
  assert v_rec.net_pay = v_rec.gross_salary - v_rec.nssf_employee - v_rec.shif - v_rec.ahl - v_rec.paye - v_rec.other_deductions, '5: net pay still equals the payroll formula';
  assert exists (select 1 from jsonb_array_elements(v_rec.deductions_breakdown) x where x ->> 'source' = 'staff_loans' and x ->> 'loan_id' = l1::text and (x ->> 'amount')::numeric = v_expected and x ->> 'name' = 'Staff loan repayment'), '5: a named line on the payslip';
  assert (select count(*) from staff_loan_deductions where payroll_record_id = rec1 and status = 'planned') = 1, '5: one planned deduction';
  assert (v_rec.gross_salary * 2 / 3) >= (v_stat + v_rec.other_deductions), '5: total deductions within two-thirds of wages';
  assert v_expected <= (v_rec.gross_salary - v_stat - v_before.other_deductions) * 0.5, '5: the loan is within half of the pay left';
  v_res := apply_staff_loans_to_draft(rec1);
  select * into v_rec from payroll_records where id = rec1;
  assert (v_res ->> 'total')::numeric = v_expected and v_rec.other_deductions = v_before.other_deductions + v_expected and v_rec.net_pay = v_before.net_pay - v_expected, '5: applying twice does not double the deduction';
  assert (select count(*) from staff_loan_deductions where payroll_record_id = rec1) = 1 and jsonb_array_length(v_rec.deductions_breakdown) = 1, '5: still one planned row and one payslip line';

  -- 6. before the first deduction month nothing is due
  rec3 := (generate_payroll_record(su_b1, 2026::smallint, 2::smallint, 50000, 0, null, null, null)).id;
  v_res := apply_staff_loans_to_draft(rec3);
  assert (v_res ->> 'total')::numeric = 0, '6: February is before the first deduction month (March)';

  -- 7. the legal caps bind: low wages and large other deductions
  perform set_config('request.jwt.claims', json_build_object('sub', u_po, 'role', 'authenticated')::text, true);
  l4 := create_staff_loan(su_b3, 'loan', 30000, 5000, 2026, 3, 'low wage borrower');
  perform set_config('request.jwt.claims', json_build_object('sub', u_p1, 'role', 'authenticated')::text, true);
  perform approve_staff_loan(l4, date '2026-02-20');
  perform set_config('request.jwt.claims', json_build_object('sub', u_po, 'role', 'authenticated')::text, true);
  rec8 := (generate_payroll_record(su_b3, 2026::smallint, 4::smallint, 20000, 9000, 'Co-op shares and rent', null, null)).id;
  select * into v_before from payroll_records where id = rec8;
  v_stat := v_before.nssf_employee + v_before.shif + v_before.ahl + v_before.paye;
  v_cap := trunc(greatest(least((v_before.gross_salary * 2 / 3) - v_stat - v_before.other_deductions, (v_before.gross_salary - v_stat - v_before.other_deductions) * 0.5), 0) * 100) / 100;
  assert v_cap > 0 and v_cap < 5000, '7: fixture really makes the cap bind';
  v_res := apply_staff_loans_to_draft(rec8);
  assert (v_res ->> 'total')::numeric = v_cap and (v_res ->> 'capped')::boolean = true, '7: the instalment is cut to the cap and flagged';
  select * into v_rec from payroll_records where id = rec8;
  assert v_rec.net_pay >= 0 and v_rec.net_pay = v_rec.gross_salary - v_rec.nssf_employee - v_rec.shif - v_rec.ahl - v_rec.paye - v_rec.other_deductions, '7: net pay is still valid';
  assert (v_stat + v_rec.other_deductions) <= v_rec.gross_salary * 2 / 3 + 0.005, '7: total deductions never pass two-thirds of wages';
  assert (v_res ->> 'total')::numeric <= (v_rec.gross_salary - v_stat - v_before.other_deductions) * 0.5 + 0.005, '7: nor half of the pay left';

  -- 8. regenerate the draft: the loan line goes, the stale plan is released at payment, nothing is recorded
  perform generate_payroll_record(su_b1, 2026::smallint, 4::smallint, 50000, 0, null, null, null);
  select * into v_rec from payroll_records where id = rec1;
  assert v_rec.other_deductions = 0 and (select count(*) from staff_loan_deductions where payroll_record_id = rec1 and status = 'planned') = 1, '8: regenerating drops the line and leaves a stale plan';
  perform set_config('request.jwt.claims', json_build_object('sub', u_p1, 'role', 'authenticated')::text, true);
  perform approve_payroll_record(rec1);
  perform set_config('request.jwt.claims', json_build_object('sub', u_po, 'role', 'authenticated')::text, true);
  perform mark_payroll_paid(rec1);
  assert (select status from staff_loan_deductions where payroll_record_id = rec1) = 'released', '8: the stale plan is released';
  assert (select count(*) from staff_loan_entries where loan_id = l1) = 0, '8: no repayment is recorded for a payslip that does not carry it';

  -- 9. the full flow: apply, approve, pay, and the ledger follows in the same transaction
  rec4 := (generate_payroll_record(su_b1, 2026::smallint, 5::smallint, 50000, 0, null, null, null)).id;
  v_res := apply_staff_loans_to_draft(rec4);
  v_x := (v_res ->> 'total')::numeric;
  assert v_x > 0, '9: something is due in May';
  assert (select count(*) from staff_loan_entries where loan_id = l1) = 0, '9: nothing is recorded as repaid until the payroll is paid';
  perform set_config('request.jwt.claims', json_build_object('sub', u_p1, 'role', 'authenticated')::text, true);
  perform approve_payroll_record(rec4);
  perform set_config('request.jwt.claims', json_build_object('sub', u_po, 'role', 'authenticated')::text, true);
  v_failed := false; begin perform apply_staff_loans_to_draft(rec4); exception when sqlstate '22023' then v_failed := true; end;
  assert v_failed, '9: an approved record cannot take loan changes';
  perform mark_payroll_paid(rec4);
  assert (select count(*) from staff_loan_entries where loan_id = l1 and kind = 'repayment' and payroll_record_id = rec4 and amount = v_x and period_year = 2026 and period_month = 5) = 1, '9: one repayment, with its period and payroll record';
  assert (select status from staff_loan_deductions where payroll_record_id = rec4) = 'applied', '9: the deduction is applied';
  assert (select balance from staff_loan_balances where loan_id = l1) = 30000 - v_x, '9: balance is principal minus repayment';

  -- 10. a payment that would diverge from the ledger is blocked, loudly
  rec5 := (generate_payroll_record(su_b1, 2026::smallint, 6::smallint, 50000, 0, null, null, null)).id;
  perform apply_staff_loans_to_draft(rec5);
  perform set_config('request.jwt.claims', json_build_object('sub', u_p1, 'role', 'authenticated')::text, true);
  perform approve_payroll_record(rec5);
  execute 'reset role';
  update staff_loans set status = 'cancelled', closed_reason = 'test: closed behind the payroll' where id = l1;
  execute 'set local role authenticated';
  perform set_config('request.jwt.claims', json_build_object('sub', u_po, 'role', 'authenticated')::text, true);
  v_failed := false; begin perform mark_payroll_paid(rec5); exception when sqlstate '22023' then v_failed := true; end;
  assert v_failed, '10: payment is blocked when a deducted loan is no longer active';
  assert (select status from payroll_records where id = rec5) = 'approved', '10: and the record stays approved';
  execute 'reset role';
  update staff_loans set status = 'active', closed_reason = null where id = l1;
  execute 'set local role authenticated';
  perform set_config('request.jwt.claims', json_build_object('sub', u_po, 'role', 'authenticated')::text, true);
  perform mark_payroll_paid(rec5);
  assert (select status from payroll_records where id = rec5) = 'paid', '10: with the loan active again the payment goes through';

  -- 11. paying off: the last instalment is only what is left, the loan closes, and no more is ever due
  l5 := create_staff_loan(su_b2, 'loan', 6000, 5000, 2026, 7, 'small loan');
  perform set_config('request.jwt.claims', json_build_object('sub', u_p1, 'role', 'authenticated')::text, true);
  perform approve_staff_loan(l5, date '2026-06-15');
  perform set_config('request.jwt.claims', json_build_object('sub', u_po, 'role', 'authenticated')::text, true);
  rec6 := (generate_payroll_record(su_b2, 2026::smallint, 7::smallint, 50000, 0, null, null, null)).id;
  assert (apply_staff_loans_to_draft(rec6) ->> 'total')::numeric = 5000, '11: first instalment is 5,000';
  perform set_config('request.jwt.claims', json_build_object('sub', u_p1, 'role', 'authenticated')::text, true);
  perform approve_payroll_record(rec6);
  perform set_config('request.jwt.claims', json_build_object('sub', u_po, 'role', 'authenticated')::text, true);
  perform mark_payroll_paid(rec6);
  rec7 := (generate_payroll_record(su_b2, 2026::smallint, 8::smallint, 50000, 0, null, null, null)).id;
  assert (apply_staff_loans_to_draft(rec7) ->> 'total')::numeric = 1000, '11: the last instalment is only what is left';
  perform set_config('request.jwt.claims', json_build_object('sub', u_p1, 'role', 'authenticated')::text, true);
  perform approve_payroll_record(rec7);
  perform set_config('request.jwt.claims', json_build_object('sub', u_po, 'role', 'authenticated')::text, true);
  perform mark_payroll_paid(rec7);
  assert (select status from staff_loans where id = l5) = 'paid_off' and (select balance from staff_loan_balances where loan_id = l5) = 0, '11: the loan closes at zero';
  rec9 := (generate_payroll_record(su_b2, 2026::smallint, 9::smallint, 50000, 0, null, null, null)).id;
  assert (apply_staff_loans_to_draft(rec9) ->> 'total')::numeric = 0, '11: nothing more is due once it is paid off';
  execute 'reset role';
  v_failed := false; begin insert into staff_loan_entries (school_id, loan_id, kind, amount) values (sa, l1, 'manual_repayment', 999999); exception when sqlstate '22023' then v_failed := true; end;
  assert v_failed, '11: the ledger can never repay more than was lent';
  execute 'set local role authenticated';
  perform set_config('request.jwt.claims', json_build_object('sub', u_po, 'role', 'authenticated')::text, true);

  -- 12. repayments handed back by hand
  v_res := record_staff_loan_repayment(l1, 1000, 'Cash handed to the bursar', 'rep-1');
  assert (v_res ->> 'duplicate')::boolean = false, '12: recorded';
  v_res := record_staff_loan_repayment(l1, 1000, 'Cash handed to the bursar', 'rep-1');
  assert (v_res ->> 'duplicate')::boolean = true and (select count(*) from staff_loan_entries where loan_id = l1 and client_ref = 'rep-1') = 1, '12: a retry is not recorded twice';
  v_failed := false; begin perform record_staff_loan_repayment(l1, 99999999, null, 'rep-2'); exception when sqlstate '22023' then v_failed := true; end;
  assert v_failed, '12: more than is owed is refused';
  v_failed := false; begin perform record_staff_loan_repayment(l1, 10.555, null, 'rep-3'); exception when sqlstate '22023' then v_failed := true; end;
  assert v_failed, '12: fractional cents refused';
  v_failed := false; begin perform record_staff_loan_repayment(l2, 100, null, 'rep-4'); exception when sqlstate '22023' then v_failed := true; end;
  assert v_failed, '12: a pending loan takes no repayment';

  -- 13. cancel and write off
  perform cancel_staff_loan(l2, 'Staff member withdrew the request');
  assert (select status from staff_loans where id = l2) = 'cancelled', '13: a pending loan can be cancelled';
  v_failed := false; begin perform cancel_staff_loan(l1, 'too late'); exception when sqlstate '22023' then v_failed := true; end;
  assert v_failed, '13: a loan with repayments cannot be cancelled';
  v_failed := false; begin perform write_off_staff_loan(l1, 'payroll officer tries'); exception when sqlstate '42501' then v_failed := true; end;
  assert v_failed, '13: a payroll officer cannot write off';
  perform set_config('request.jwt.claims', json_build_object('sub', u_p1, 'role', 'authenticated')::text, true);
  perform approve_staff_loan(l3, date '2026-02-20');
  perform set_config('request.jwt.claims', json_build_object('sub', u_p2, 'role', 'authenticated')::text, true);
  v_failed := false; begin perform write_off_staff_loan(l3, 'writing off my own'); exception when sqlstate '42501' then v_failed := true; end;
  assert v_failed, '13: the borrower cannot write off their own loan';
  perform set_config('request.jwt.claims', json_build_object('sub', u_p1, 'role', 'authenticated')::text, true);
  v_x := write_off_staff_loan(l1, 'Hardship, approved by the board');
  assert v_x = (select principal from staff_loans where id = l1) - (select coalesce(sum(amount), 0) from staff_loan_entries where loan_id = l1 and kind <> 'write_off'), '13: the write-off is exactly what was left';
  assert (select status from staff_loans where id = l1) = 'paid_off' and (select balance from staff_loan_balances where loan_id = l1) = 0, '13: and the loan is closed';

  -- 14. append-only
  execute 'reset role';
  v_failed := false; begin update staff_loan_entries set amount = 1 where loan_id = l1; exception when sqlstate '42501' then v_failed := true; end;
  assert v_failed, '14: ledger cannot be edited';
  v_failed := false; begin delete from staff_loan_entries where loan_id = l1; exception when sqlstate '42501' then v_failed := true; end;
  assert v_failed, '14: ledger cannot be deleted';
  v_failed := false; begin delete from staff_loan_deductions where payroll_record_id = rec4; exception when sqlstate '42501' then v_failed := true; end;
  assert v_failed, '14: an applied deduction cannot be deleted';
  v_failed := false; begin update staff_loan_deductions set amount = 1 where payroll_record_id = rec4; exception when sqlstate '42501' then v_failed := true; end;
  assert v_failed, '14: an applied deduction cannot be edited';

  -- 15. visibility
  execute 'set local role authenticated';
  perform set_config('request.jwt.claims', json_build_object('sub', u_b1, 'role', 'authenticated')::text, true);
  assert (select count(*) from staff_loans) = 2 and not exists (select 1 from staff_loans where staff_id <> su_b1), '15: a borrower sees only their own loans';
  assert (select count(*) from staff_loan_entries) > 0 and not exists (select 1 from staff_loan_entries where loan_id in (l4, l5)), '15: and only their own ledger';
  perform set_config('request.jwt.claims', json_build_object('sub', u_b2, 'role', 'authenticated')::text, true);
  assert (select count(*) from staff_loans) = 1, '15: another borrower sees only theirs';
  perform set_config('request.jwt.claims', json_build_object('sub', u_po, 'role', 'authenticated')::text, true);
  assert (select count(*) from staff_loans) = 5, '15: payroll staff see them all';
  perform set_config('request.jwt.claims', json_build_object('sub', u_par, 'role', 'authenticated')::text, true);
  assert (select count(*) from staff_loans) = 0 and (select count(*) from staff_loan_balances) = 0, '15: a parent sees none';
  perform set_config('request.jwt.claims', json_build_object('sub', u_xb, 'role', 'authenticated')::text, true);
  assert (select count(*) from staff_loans) = 0, '15: another school sees none';
  v_failed := false; begin insert into staff_loans (school_id, staff_id, kind, principal, installment, first_year, first_month) values (sa, su_b1, 'loan', 1, 1, 2026, 1);
  exception when others then get stacked diagnostics v_state = returned_sqlstate; v_failed := (v_state = '42501'); end;
  assert v_failed, '15: direct writes are refused';

  -- 16. who may apply loans to payroll
  perform set_config('request.jwt.claims', json_build_object('sub', u_b1, 'role', 'authenticated')::text, true);
  v_failed := false; begin perform apply_staff_loans_to_draft(rec9); exception when sqlstate '42501' then v_failed := true; end;
  assert v_failed, '16: a staff member cannot apply loans to payroll';
  execute 'reset role';

  -- 17. locked down
  assert not has_function_privilege('anon', 'public.create_staff_loan(uuid,text,numeric,numeric,integer,integer,text)', 'execute'), '17: anon create';
  assert not has_function_privilege('anon', 'public.apply_staff_loans_to_draft(uuid)', 'execute'), '17: anon apply';
  assert not has_function_privilege('authenticated', 'public.staff_loans_guard(text)', 'execute'), '17: guard is internal';
  assert not has_function_privilege('authenticated', 'public.staff_loan_payroll_paid()', 'execute'), '17: trigger function is internal';
  assert exists (select 1 from audit_log where table_name = 'staff_loans' and record_id = l1 and school_id = sa), '17: loan changes are audited';

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
