-- Behavioural test for WP 4.3 (migration *_wp_4_3_refunds_core). Rollback-only, synthetic fixtures.
--   psql "$SUPABASE_DB_URL" -v ON_ERROR_STOP=1 -f supabase/tests/refunds.sql
-- Callers are simulated with request.jwt.claims + role authenticated (aal2, because production
-- enforces admin MFA). Everything runs in one transaction that ends in `rollback;`; a final
-- tripwire fails loudly if any fixture row persisted. The test only touches its own fixture
-- schools, so it does not depend on which flags are on for real schools.
begin;

create function pg_temp.err(q text) returns text language plpgsql as $f$
begin execute q; return null; exception when others then return sqlerrm; end $f$;

create function pg_temp.as_user(p_uid uuid) returns void language plpgsql as $f$
begin
  execute 'set local role authenticated';
  perform set_config('request.jwt.claims', json_build_object('sub', p_uid, 'role', 'authenticated', 'aal', 'aal2')::text, true);
end $f$;

create function pg_temp.as_admin() returns void language plpgsql as $f$
begin
  execute 'reset role';
  perform set_config('request.jwt.claims', '', true);
end $f$;

do $$
declare
  sa uuid := gen_random_uuid(); sb uuid := gen_random_uuid();
  u_bur uuid := gen_random_uuid(); u_pri uuid := gen_random_uuid(); u_own uuid := gen_random_uuid();
  u_tea uuid := gen_random_uuid(); u_ownb uuid := gen_random_uuid();
  r_bur uuid; r_pri uuid; r_own uuid; r_tea uuid;
  su_bur uuid; su_pri uuid; su_own uuid; su_ownb uuid;
  ay uuid := gen_random_uuid(); tm uuid := gen_random_uuid();
  s1 uuid := gen_random_uuid(); s2 uuid := gen_random_uuid(); sbk uuid := gen_random_uuid();
  inv1 uuid := gen_random_uuid();
  p1 uuid := gen_random_uuid(); p2 uuid := gen_random_uuid(); p3 uuid := gen_random_uuid();
  p4 uuid := gen_random_uuid(); p5 uuid := gen_random_uuid(); p6 uuid := gen_random_uuid(); pb uuid := gen_random_uuid();
  f_ref uuid; f_cash uuid;
  q1 uuid; q2 uuid; q3 uuid; q4 uuid; q5 uuid; qb uuid;
  v_err text; v_n integer; v_num numeric; v_txt text; v_bool boolean;
  v_total_paid_before numeric; v_invoiced_before numeric;
begin
  select id into r_bur from roles where name = 'bursar';
  select id into r_pri from roles where name = 'principal';
  select id into r_own from roles where name = 'school_owner';
  select id into r_tea from roles where name = 'teacher';
  assert r_bur is not null and r_pri is not null and r_own is not null and r_tea is not null, 'roles exist';

  select id into f_ref from platform_feature_flags where key = 'feature.finance.refunds';
  assert f_ref is not null, 'refund flag catalog entry exists';
  select id into f_cash from platform_feature_flags where key = 'feature.finance.cashbook';
  assert f_cash is not null, 'cashbook flag catalog entry exists';

  -- default grants: approving is for school_owner and principal only; bursar can request and pay out
  assert exists (select 1 from role_permissions where role_id = r_pri and school_id is null and permission_key = 'finance.refund.approve' and allowed), 'principal may approve refunds';
  assert exists (select 1 from role_permissions where role_id = r_own and school_id is null and permission_key = 'finance.refund.approve' and allowed), 'owner may approve refunds';
  assert not exists (select 1 from role_permissions where role_id = r_bur and school_id is null and permission_key = 'finance.refund.approve'), 'bursar may NOT approve refunds';

  -- ---------- fixtures ----------
  insert into auth.users (id, aud, role, email) values
    (u_bur, 'authenticated', 'authenticated', 'refund-bur@example.invalid'),
    (u_pri, 'authenticated', 'authenticated', 'refund-pri@example.invalid'),
    (u_own, 'authenticated', 'authenticated', 'refund-own@example.invalid'),
    (u_tea, 'authenticated', 'authenticated', 'refund-tea@example.invalid'),
    (u_ownb, 'authenticated', 'authenticated', 'refund-ownb@example.invalid');
  insert into schools (id, name, slug, application_number_prefix) values
    (sa, 'Refund Test A', 'refund-test-a', 'RFA'), (sb, 'Refund Test B', 'refund-test-b', 'RFB');
  insert into school_users (auth_user_id, school_id, role_id, full_name, status) values
    (u_bur, sa, r_bur, 'Refund Bursar', 'active'),
    (u_pri, sa, r_pri, 'Refund Principal', 'active'),
    (u_own, sa, r_own, 'Refund Owner A', 'active'),
    (u_tea, sa, r_tea, 'Refund Teacher', 'active'),
    (u_ownb, sb, r_own, 'Refund Owner B', 'active');
  select id into su_bur from school_users where auth_user_id = u_bur;
  select id into su_pri from school_users where auth_user_id = u_pri;
  select id into su_own from school_users where auth_user_id = u_own;
  select id into su_ownb from school_users where auth_user_id = u_ownb;

  insert into academic_years (id, school_id, name, start_date, end_date) values (ay, sa, 'RF Year', '2026-01-01', '2026-12-31');
  insert into terms (id, school_id, academic_year_id, name, term_number, start_date, end_date) values (tm, sa, ay, 'RF Term', 1, '2026-01-01', '2026-04-01');
  insert into students (id, school_id, first_name, last_name, date_of_birth, gender, status) values
    (s1, sa, 'Rita', 'Refund', date '2012-01-01', 'female', 'approved'),
    (s2, sa, 'Pen', 'Refund', date '2012-01-03', 'female', 'approved'),
    (sbk, sb, 'Bo', 'Refund', date '2012-01-02', 'male', 'approved');
  insert into invoices (id, school_id, student_id, term_id, total_amount) values (inv1, sa, s1, tm, 3000);

  -- p1: 5000 paid, 3000 applied to the invoice, so 2000 is held as credit.
  -- p2: 1500 paid, nothing applied (all credit). p3: unallocated, no learner. p4: pending (second learner:
  -- v_student_balances counts a pending payment as received, so it is kept off learner 1).
  -- p5: 800 all credit. p6: 600 all credit. pb (school B): 400 all credit.
  insert into payments (id, school_id, student_id, method, amount, reference, status, source, recorded_at) values
    (p1, sa, s1, 'cash', 5000, 'RF-P1', 'confirmed', 'manual', timestamptz '2026-03-10 09:00+03'),
    (p2, sa, s1, 'mpesa', 1500, 'RF-P2', 'confirmed', 'manual', timestamptz '2026-03-10 10:00+03'),
    (p3, sa, null, 'mpesa', 300, 'RF-P3', 'unallocated', 'api', timestamptz '2026-03-10 11:00+03'),
    (p4, sa, s2, 'mpesa', 200, 'RF-P4', 'pending', 'manual', timestamptz '2026-03-10 12:00+03'),
    (p5, sa, s1, 'cash', 800, 'RF-P5', 'confirmed', 'manual', timestamptz '2026-03-11 09:00+03'),
    (p6, sa, s1, 'cash', 600, 'RF-P6', 'confirmed', 'manual', timestamptz '2026-03-11 10:00+03'),
    (pb, sb, sbk, 'cash', 400, 'RF-PB', 'confirmed', 'manual', timestamptz '2026-03-11 11:00+03');
  insert into payment_allocations (payment_id, invoice_id, amount_allocated, entry_type) values (p1, inv1, 3000, 'allocation');

  -- credit = payments (5000+1500+800+600, pending/unallocated excluded) - applied 3000 = 4900
  assert (select credit_balance from v_student_balances where student_id = s1) = 4900, 'fixture credit is 4900';
  v_total_paid_before := (select total_paid from v_student_balances where student_id = s1);
  v_invoiced_before := (select total_invoiced from v_student_balances where student_id = s1);
  assert refund_payment_available(p1) = 2000 and refund_payment_available(p2) = 1500, 'availability per payment';

  -- ---------- 0. flag off: nothing works ----------
  perform pg_temp.as_user(u_bur);
  v_err := pg_temp.err(format('select create_refund_request(%L, 100, ''overpayment'')', p1));
  assert v_err = 'Refunds are not enabled for your school.', '0: flag off refuses request: ' || coalesce(v_err, 'accepted');
  perform pg_temp.as_admin();
  insert into school_feature_flags (school_id, flag_id, enabled) values (sa, f_ref, true), (sb, f_ref, true), (sa, f_cash, true);

  -- ---------- 1. permissions ----------
  perform pg_temp.as_user(u_tea);
  v_err := pg_temp.err(format('select create_refund_request(%L, 100, ''overpayment'')', p1));
  assert v_err = 'Not authorized to request refunds.', '1: teacher refused: ' || coalesce(v_err, 'accepted');
  perform pg_temp.as_admin();
  v_err := pg_temp.err(format('select create_refund_request(%L, 100, ''overpayment'')', p1));
  assert v_err = 'Not authorized to request refunds.', '1: no caller refused: ' || coalesce(v_err, 'accepted');

  -- ---------- 2. validation (bursar) ----------
  perform pg_temp.as_user(u_bur);
  v_err := pg_temp.err(format('select create_refund_request(%L, 0, ''overpayment'')', p1));
  assert v_err like 'Refund amount must be a whole number%', '2: zero refused: ' || coalesce(v_err, 'accepted');
  v_err := pg_temp.err(format('select create_refund_request(%L, 100.5, ''overpayment'')', p1));
  assert v_err like 'Refund amount must be a whole number%', '2: fractional refused: ' || coalesce(v_err, 'accepted');
  v_err := pg_temp.err(format('select create_refund_request(%L, -5, ''overpayment'')', p1));
  assert v_err like 'Refund amount must be a whole number%', '2: negative refused: ' || coalesce(v_err, 'accepted');
  v_err := pg_temp.err(format('select create_refund_request(%L, 100, ''bogus'')', p1));
  assert v_err = 'Choose a valid refund reason.', '2: bad reason refused: ' || coalesce(v_err, 'accepted');
  v_err := pg_temp.err(format('select create_refund_request(%L, 100, ''other'')', p1));
  assert v_err = 'Describe the reason for this refund.', '2: other needs a note: ' || coalesce(v_err, 'accepted');
  v_err := pg_temp.err(format('select create_refund_request(%L, 100, ''overpayment'')', gen_random_uuid()));
  assert v_err = 'Payment not found.', '2: unknown payment: ' || coalesce(v_err, 'accepted');
  v_err := pg_temp.err(format('select create_refund_request(%L, 100, ''overpayment'')', pb));
  assert v_err = 'Payment not found.', '2: another school''s payment looks like it does not exist: ' || coalesce(v_err, 'accepted');
  v_err := pg_temp.err(format('select create_refund_request(%L, 100, ''overpayment'')', p3));
  assert v_err like 'Only a confirmed or recorded payment%', '2: unallocated payment refused: ' || coalesce(v_err, 'accepted');
  v_err := pg_temp.err(format('select create_refund_request(%L, 100, ''overpayment'')', p4));
  assert v_err like 'Only a confirmed or recorded payment%', '2: pending payment refused: ' || coalesce(v_err, 'accepted');
  -- p1 is 5000 but only 2000 is credit: the 3000 applied to the invoice cannot be refunded here
  v_err := pg_temp.err(format('select create_refund_request(%L, 2001, ''overpayment'')', p1));
  assert v_err like 'Refund exceeds the part of this payment that is held as credit%', '2: more than the credit refused: ' || coalesce(v_err, 'accepted');
  v_err := pg_temp.err(format('select create_refund_request(%L, 5000, ''overpayment'')', p1));
  assert v_err like 'Refund exceeds the part of this payment that is held as credit%', '2: the whole payment refused: ' || coalesce(v_err, 'accepted');

  -- ---------- 3. request: changes no balance ----------
  q1 := create_refund_request(p1, 2000, 'overpayment', 'Parent paid twice');
  assert q1 is not null, '3: request created';
  perform pg_temp.as_admin();
  assert (select status from refund_requests where id = q1) = 'requested', '3: status requested';
  assert (select credit_balance from v_student_balances where student_id = s1) = 4900, '3: request changed no credit';
  assert (select total_paid from v_student_balances where student_id = s1) = v_total_paid_before, '3: request changed no fees paid';
  assert not exists (select 1 from payment_reversals where payment_id = p1), '3: request wrote no reversal';
  assert exists (select 1 from audit_log where table_name = 'refund_requests' and record_id = q1 and action = 'create'), '3: request audited';

  -- one open request per payment
  perform pg_temp.as_user(u_bur);
  v_err := pg_temp.err(format('select create_refund_request(%L, 100, ''overpayment'')', p1));
  assert v_err = 'This payment already has a refund request in progress.', '3: second open request refused: ' || coalesce(v_err, 'accepted');

  -- ---------- 4. approval rules ----------
  v_err := pg_temp.err(format('select decide_refund_request(%L, true)', q1));
  assert v_err = 'Not authorized to decide refund requests.', '4: bursar cannot approve: ' || coalesce(v_err, 'accepted');
  v_err := pg_temp.err(format('select record_refund_payout(%L, ''cash'', ''V1'')', q1));
  assert v_err = 'Only an approved refund can be paid out.', '4: cannot pay out before approval: ' || coalesce(v_err, 'accepted');
  perform pg_temp.as_user(u_pri);
  v_err := pg_temp.err(format('select decide_refund_request(%L, false)', q1));
  assert v_err = 'Give a reason for rejecting this request.', '4: reject needs a reason: ' || coalesce(v_err, 'accepted');
  perform decide_refund_request(q1, true, 'Checked the statement');
  perform pg_temp.as_admin();
  assert (select status from refund_requests where id = q1) = 'approved', '4: approved';
  assert (select decided_by from refund_requests where id = q1) = su_pri, '4: decided by the principal';
  assert (select credit_balance from v_student_balances where student_id = s1) = 4900, '4: approval changed no credit';
  assert not exists (select 1 from payment_reversals where payment_id = p1), '4: approval wrote no reversal';
  perform pg_temp.as_user(u_pri);
  v_err := pg_temp.err(format('select decide_refund_request(%L, true)', q1));
  assert v_err = 'This refund request has already been decided.', '4: cannot decide twice: ' || coalesce(v_err, 'accepted');
  v_err := pg_temp.err(format('select record_refund_payout(%L, ''cash'', ''V1'')', q1));
  assert v_err = 'Not authorized to record refund pay-outs.', '4: principal has no finance.write so cannot pay out: ' || coalesce(v_err, 'accepted');

  -- ---------- 5. pay-out: the only step that changes a balance ----------
  perform pg_temp.as_user(u_bur);
  v_err := pg_temp.err(format('select record_refund_payout(%L, ''paypal'', ''V1'')', q1));
  assert v_err = 'Choose how the refund was paid.', '5: bad method refused: ' || coalesce(v_err, 'accepted');
  v_err := pg_temp.err(format('select record_refund_payout(%L, ''cash'', ''   '')', q1));
  assert v_err like 'Enter the payment reference%', '5: blank reference refused: ' || coalesce(v_err, 'accepted');
  v_err := pg_temp.err(format('select record_refund_payout(%L, ''cash'', ''V1'', now() + interval ''2 days'')', q1));
  assert v_err = 'The pay-out date cannot be in the future.', '5: future date refused: ' || coalesce(v_err, 'accepted');
  perform pg_temp.as_admin();
  assert not exists (select 1 from payment_reversals where payment_id = p1), '5: refused attempts wrote nothing';
  perform pg_temp.as_user(u_bur);
  perform record_refund_payout(q1, 'mpesa', 'SAB1CD2EFG');
  perform pg_temp.as_admin();
  assert (select count(*) from payment_reversals where payment_id = p1) = 1 and (select amount from payment_reversals where payment_id = p1) = 2000, '5: exactly one reversal of 2000';
  assert (select status from payments where id = p1) = 'confirmed', '5: p1 not fully reversed, stays confirmed';
  assert (select count(*) from payment_allocations where payment_id = p1) = 1 and (select sum(amount_allocated) from payment_allocations where payment_id = p1) = 3000, '5: allocations untouched';
  assert (select total_paid from v_student_balances where student_id = s1) = v_total_paid_before, '5: fees paid unchanged';
  assert (select total_invoiced from v_student_balances where student_id = s1) = v_invoiced_before, '5: invoiced unchanged';
  assert (select total_amount from invoices where id = inv1) = 3000, '5: the invoice itself is untouched';
  assert (select credit_balance from v_student_balances where student_id = s1) = 2900, '5: credit fell by exactly the refund (4900 - 2000)';
  assert (select status from refund_requests where id = q1) = 'paid', '5: request paid';
  assert (select amount from refund_payouts where refund_request_id = q1) = 2000
     and (select method from refund_payouts where refund_request_id = q1) = 'mpesa'
     and (select reference from refund_payouts where refund_request_id = q1) = 'SAB1CD2EFG'
     and (select paid_by from refund_payouts where refund_request_id = q1) = su_bur, '5: payout record is complete';
  assert (select payment_reversal_id from refund_payouts where refund_request_id = q1) = (select id from payment_reversals where payment_id = p1), '5: payout linked to its reversal';
  assert exists (select 1 from audit_log where table_name = 'refund_requests' and record_id = q1 and action = 'refund_paid'), '5: payout audited';
  assert exists (select 1 from audit_log where table_name = 'payments' and record_id = p1 and action = 'reverse'), '5: payment history shows the refund';

  perform pg_temp.as_user(u_bur);
  v_err := pg_temp.err(format('select record_refund_payout(%L, ''mpesa'', ''SAB1CD2EFG'')', q1));
  assert v_err = 'Only an approved refund can be paid out.', '5: cannot pay out twice: ' || coalesce(v_err, 'accepted');
  v_err := pg_temp.err(format('select create_refund_request(%L, 1, ''overpayment'')', p1));
  assert v_err like 'Refund exceeds the part of this payment that is held as credit%', '5: nothing left to refund on p1: ' || coalesce(v_err, 'accepted');

  -- ---------- 6. a fully refunded payment becomes reversed ----------
  q2 := create_refund_request(p2, 1500, 'duplicate_payment');
  perform pg_temp.as_user(u_pri);
  perform decide_refund_request(q2, true);
  perform pg_temp.as_user(u_bur);
  perform record_refund_payout(q2, 'bank', 'BNK-0001', now() - interval '1 hour');
  perform pg_temp.as_admin();
  assert (select status from payments where id = p2) = 'reversed', '6: fully refunded payment is reversed';
  assert (select credit_balance from v_student_balances where student_id = s1) = 1400, '6: credit now 1400 (2900 - 1500)';

  -- ---------- 7. two-person rule ----------
  -- school A has two approvers (owner, principal): the owner cannot approve their own request
  perform pg_temp.as_user(u_own);
  q3 := create_refund_request(p5, 800, 'paid_in_error');
  v_err := pg_temp.err(format('select decide_refund_request(%L, true)', q3));
  assert v_err = 'You requested this refund, so someone else with approval rights needs to approve it.', '7: self-approval refused when another approver exists: ' || coalesce(v_err, 'accepted');
  perform pg_temp.as_user(u_pri);
  perform decide_refund_request(q3, true);
  perform pg_temp.as_admin();
  assert (select (new_data->>'self_approved')::boolean from audit_log where table_name = 'refund_requests' and record_id = q3 and action = 'approve') = false, '7: audit says not self-approved';
  perform pg_temp.as_user(u_own);
  perform record_refund_payout(q3, 'cash', 'VCH-77');
  perform pg_temp.as_admin();
  assert (select credit_balance from v_student_balances where student_id = s1) = 600, '7: credit now 600 (1400 - 800)';

  -- school B has a single approver: self-approval is allowed and flagged
  perform pg_temp.as_user(u_ownb);
  qb := create_refund_request(pb, 400, 'overpayment');
  perform decide_refund_request(qb, true);
  perform pg_temp.as_admin();
  assert (select status from refund_requests where id = qb) = 'approved', '7: single-approver school may self-approve';
  assert (select (new_data->>'self_approved')::boolean from audit_log where table_name = 'refund_requests' and record_id = qb and action = 'approve') = true, '7: self-approval flagged in the audit log';

  -- ---------- 8. reject, cancel, and a new request after either ----------
  perform pg_temp.as_user(u_bur);
  q4 := create_refund_request(p6, 600, 'other', 'Wrong child');
  perform pg_temp.as_user(u_pri);
  perform decide_refund_request(q4, false, 'Not enough evidence');
  perform pg_temp.as_admin();
  assert (select status from refund_requests where id = q4) = 'rejected', '8: rejected';
  assert (select credit_balance from v_student_balances where student_id = s1) = 600, '8: rejection changed nothing';
  perform pg_temp.as_user(u_bur);
  q5 := create_refund_request(p6, 600, 'paid_in_error');
  perform cancel_refund_request(q5, 'Parent changed their mind');
  perform pg_temp.as_admin();
  assert (select status from refund_requests where id = q5) = 'cancelled', '8: cancelled';
  perform pg_temp.as_user(u_bur);
  v_err := pg_temp.err(format('select cancel_refund_request(%L)', q5));
  assert v_err = 'Only a request that has not been paid out can be cancelled.', '8: cannot cancel twice: ' || coalesce(v_err, 'accepted');
  v_err := pg_temp.err(format('select cancel_refund_request(%L)', q1));
  assert v_err = 'Only a request that has not been paid out can be cancelled.', '8: cannot cancel a paid refund: ' || coalesce(v_err, 'accepted');

  -- ---------- 9. credit can change between approval and pay-out ----------
  perform pg_temp.as_user(u_bur);
  q5 := create_refund_request(p6, 600, 'overpayment');
  perform pg_temp.as_user(u_pri);
  perform decide_refund_request(q5, true);
  perform pg_temp.as_admin();
  -- the invoice grows after approval and the credit on p6 is applied to it
  update invoices set total_amount = 3600 where id = inv1;
  insert into payment_allocations (payment_id, invoice_id, amount_allocated, entry_type) values (p6, inv1, 600, 'allocation');
  perform pg_temp.as_user(u_bur);
  v_err := pg_temp.err(format('select record_refund_payout(%L, ''cash'', ''VCH-78'')', q5));
  assert v_err like 'Refund exceeds the part of this payment that is held as credit%', '9: pay-out re-checks the ledger: ' || coalesce(v_err, 'accepted');
  perform pg_temp.as_admin();
  assert (select status from refund_requests where id = q5) = 'approved', '9: refused pay-out left the request approved';
  assert not exists (select 1 from payment_reversals where payment_id = p6), '9: refused pay-out wrote nothing';

  -- ---------- 10. tenant isolation ----------
  perform pg_temp.as_user(u_ownb);
  assert (select count(*) from refund_requests) = 1, '10: school B sees only its own request';
  assert (select count(*) from refund_payouts) = 0, '10: school B sees no school A pay-outs';
  v_err := pg_temp.err(format('select decide_refund_request(%L, true)', q5));
  assert v_err = 'Refund request not found.', '10: school B cannot decide a school A request: ' || coalesce(v_err, 'accepted');
  v_err := pg_temp.err(format('select record_refund_payout(%L, ''cash'', ''X'')', q5));
  assert v_err = 'Refund request not found.', '10: school B cannot pay out a school A request: ' || coalesce(v_err, 'accepted');
  v_err := pg_temp.err(format('select cancel_refund_request(%L)', q5));
  assert v_err = 'Refund request not found.', '10: school B cannot cancel a school A request: ' || coalesce(v_err, 'accepted');
  perform pg_temp.as_user(u_tea);
  assert (select count(*) from refund_requests) = 0, '10: a teacher sees no refund requests (no finance.read)';
  perform pg_temp.as_user(u_bur);
  assert (select count(*) from refund_requests) = 6, '10: school A bursar sees the 6 requests of school A';
  assert (select count(*) from refund_payouts) = 3, '10: school A bursar sees its 3 pay-outs';
  v_err := pg_temp.err('insert into refund_requests (school_id, payment_id, student_id, amount, reason_code) select school_id, id, student_id, 1, ''overpayment'' from payments limit 1');
  assert v_err like 'permission denied%', '10: no direct insert: ' || coalesce(v_err, 'accepted');
  v_err := pg_temp.err('update refund_payouts set amount = 1');
  assert v_err like 'permission denied%', '10: pay-outs cannot be edited: ' || coalesce(v_err, 'accepted');
  v_err := pg_temp.err('delete from refund_payouts');
  assert v_err like 'permission denied%', '10: pay-outs cannot be deleted: ' || coalesce(v_err, 'accepted');

  -- ---------- 11. the cashbook picks refunds up as money out and still reconciles ----------
  perform pg_temp.as_user(u_bur);
  assert (select reversals_total from cashbook_reconciliation()) = 4300, '11: cashbook money out from reversals = 2000 + 1500 + 800';
  assert (select reversals_difference from cashbook_reconciliation()) = 0, '11: cashbook reversals reconcile to the raw table';
  assert (select receipts_difference from cashbook_reconciliation()) = 0, '11: cashbook receipts still reconcile';

  -- ---------- 12. grants ----------
  perform pg_temp.as_admin();
  assert not has_function_privilege('anon', 'public.create_refund_request(uuid,numeric,text,text)', 'execute'), '12: anon create';
  assert not has_function_privilege('anon', 'public.decide_refund_request(uuid,boolean,text)', 'execute'), '12: anon decide';
  assert not has_function_privilege('anon', 'public.cancel_refund_request(uuid,text)', 'execute'), '12: anon cancel';
  assert not has_function_privilege('anon', 'public.record_refund_payout(uuid,text,text,timestamptz)', 'execute'), '12: anon payout';
  assert has_function_privilege('authenticated', 'public.create_refund_request(uuid,numeric,text,text)', 'execute'), '12: authenticated create';
  assert not has_function_privilege('authenticated', 'public.refund_payment_available(uuid)', 'execute'), '12: internal availability helper closed';
  assert not has_function_privilege('authenticated', 'public.refund_assert_refundable(uuid,numeric)', 'execute'), '12: internal assert helper closed';
  assert not has_table_privilege('anon', 'public.refund_requests', 'select'), '12: anon requests';
  assert not has_table_privilege('anon', 'public.refund_payouts', 'select'), '12: anon payouts';
  assert not has_table_privilege('authenticated', 'public.refund_requests', 'insert'), '12: authenticated insert';
  assert not has_table_privilege('authenticated', 'public.refund_payouts', 'update'), '12: authenticated update';

  raise notice 'refunds: all assertions passed';
end $$;

rollback;

-- Independent tripwire (own implicit transaction after the explicit rollback above).
do $$
begin
  if exists (select 1 from schools where slug in ('refund-test-a', 'refund-test-b'))
     or exists (select 1 from auth.users where email like 'refund-%@example.invalid') then
    raise exception 'LEAK DETECTED: refund test fixtures were not rolled back -- fix this test file before trusting it again';
  end if;
end
$$;
