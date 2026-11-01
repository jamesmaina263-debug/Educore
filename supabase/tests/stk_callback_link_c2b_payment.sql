-- Behavioral test for Phase 1.1g (migration 20261101120000_stk_callback_link_existing_c2b_payment).
-- Rollback-only, synthetic fixtures (one throwaway school); touches no real data.
--   psql "$SUPABASE_DB_URL" -v ON_ERROR_STOP=1 -f supabase/tests/stk_callback_link_c2b_payment.sql
-- Needs the migration already deployed. Covers: the normal STK path is unchanged, and an STK callback whose
-- receipt was already recorded by paybill (C2B) capture links to that payment without double counting.
begin;

do $$
declare
  sa uuid := gen_random_uuid();
  ay uuid := gen_random_uuid();
  term uuid := gen_random_uuid();
  s1 uuid; s2 uuid; inv1 uuid; inv2 uuid;
  v_flag_id uuid;
  r jsonb;
  v_n int; v_pay uuid; v_status text; v_linked uuid; v_amt numeric;
begin
  select id into v_flag_id from platform_feature_flags where lower(key) = 'feature.finance.c2b_capture';
  assert v_flag_id is not null, 'flag catalog row exists';

  insert into schools (id, name, slug, application_number_prefix) values (sa, 'STK Link Test', 'stk-link-test', 'SLT');
  insert into academic_years (id, school_id, name, start_date, end_date) values (ay, sa, 'Y', '2026-01-01', '2026-12-31');
  insert into terms (id, school_id, academic_year_id, name, term_number, start_date, end_date) values (term, sa, ay, 'T', 1, '2026-01-01', '2026-04-01');
  insert into students (school_id, admission_number, first_name, last_name, date_of_birth, gender, status)
    values (sa, '001', 'S', 'One', date '2015-01-01', 'male', 'approved') returning id into s1;
  insert into students (school_id, admission_number, first_name, last_name, date_of_birth, gender, status)
    values (sa, '002', 'S', 'Two', date '2015-01-01', 'female', 'approved') returning id into s2;
  insert into invoices (school_id, student_id, term_id, total_amount) values (sa, s1, term, 5000) returning id into inv1;
  insert into invoices (school_id, student_id, term_id, total_amount) values (sa, s2, term, 5000) returning id into inv2;
  insert into school_feature_flags (school_id, flag_id, enabled) values (sa, v_flag_id, true);
  insert into mpesa_c2b_config (school_id, mode) values (sa, 'live');

  -- 1. Normal STK path (no C2B involved): payment created and linked, allocation recorded. Unchanged behaviour.
  insert into mpesa_stk_requests (school_id, student_id, amount, phone_number, merchant_request_id, checkout_request_id, status)
    values (sa, s1, 100, '254700000001', 'M1', 'CHK1', 'pending');
  perform mpesa_stk_callback_confirm('CHK1', 0, 'ok', 'RCPT1', 100, '254700000001', sa);
  select status, payment_id into v_status, v_linked from mpesa_stk_requests where checkout_request_id = 'CHK1';
  assert v_status = 'completed', 'normal STK completes';
  assert v_linked is not null, 'normal STK is linked to its payment';
  select count(*) into v_n from payments where school_id = sa and reference = 'RCPT1';
  assert v_n = 1, 'normal STK creates exactly one payment';
  select amount into v_amt from payments where id = v_linked;
  assert v_amt = 100, 'normal STK payment amount';
  select count(*) into v_n from payment_allocations where payment_id = v_linked;
  assert v_n = 1, 'normal STK allocates';

  -- 2. Repeat callback for the same request: nothing changes (request no longer pending).
  perform mpesa_stk_callback_confirm('CHK1', 0, 'ok', 'RCPT1', 100, '254700000001', sa);
  select count(*) into v_n from payments where school_id = sa and reference = 'RCPT1';
  assert v_n = 1, 'repeat callback does not double count';

  -- 3. C2B recorded the receipt first (STK request older than 15 min, so no deferral), then the STK callback
  --    arrives with the SAME receipt: one payment only, and the STK request now links to the C2B payment.
  insert into mpesa_stk_requests (school_id, student_id, amount, phone_number, merchant_request_id, checkout_request_id, status, initiated_at)
    values (sa, s2, 200, '254700000002', 'M2', 'CHK2', 'pending', now() - interval '20 minutes');
  r := c2b_ingest_payment(sa, 'mpesa_c2b', 'RCPT2', 200, '002', null, now());
  assert r->>'outcome' = 'allocated', 'C2B allocates first: ' || coalesce(r->>'outcome', 'null');
  v_pay := (r->>'payment_id')::uuid;
  assert v_pay is not null, 'C2B payment id returned';
  perform mpesa_stk_callback_confirm('CHK2', 0, 'ok', 'RCPT2', 200, '254700000002', sa);
  select count(*) into v_n from payments where school_id = sa and reference = 'RCPT2';
  assert v_n = 1, 'no double count when STK arrives after C2B';
  select status, payment_id into v_status, v_linked from mpesa_stk_requests where checkout_request_id = 'CHK2';
  assert v_status = 'completed', 'STK request completes';
  assert v_linked = v_pay, 'STK request links to the C2B-recorded payment (F-1 fixed)';
  select coalesce(sum(amount_allocated), 0) into v_amt from payment_allocations where payment_id = v_pay;
  assert v_amt = 200, 'allocation unchanged by the late STK callback';

  -- 4. A receipt recorded for a DIFFERENT school is never linked (school scoping).
  --    (Same receipt text in another school must not be picked up.) Create a second school with a payment.
  declare sb uuid := gen_random_uuid(); sbs uuid;
  begin
    insert into schools (id, name, slug, application_number_prefix) values (sb, 'STK Link Other', 'stk-link-other', 'SLO');
    insert into students (school_id, admission_number, first_name, last_name, date_of_birth, gender, status)
      values (sb, '001', 'O', 'One', date '2015-01-01', 'male', 'approved') returning id into sbs;
    insert into payments (school_id, student_id, method, amount, reference, status, source)
      values (sb, sbs, 'mpesa', 300, 'RCPT3', 'unallocated', 'api');
    insert into mpesa_stk_requests (school_id, student_id, amount, phone_number, merchant_request_id, checkout_request_id, status)
      values (sa, s1, 300, '254700000003', 'M3', 'CHK3', 'pending');
    perform mpesa_stk_callback_confirm('CHK3', 0, 'ok', 'RCPT3', 300, '254700000003', sa);
    select status, payment_id into v_status, v_linked from mpesa_stk_requests where checkout_request_id = 'CHK3';
    assert v_status = 'completed', 'cross-school receipt: STK completes';
    select count(*) into v_n from payments where school_id = sa and reference = 'RCPT3';
    assert v_n = 1 and v_linked is not null and v_linked <> (select id from payments where school_id = sb and reference = 'RCPT3'),
      'cross-school receipt: own payment created, other school payment never linked';
  end;

  raise notice 'STK_LINK_C2B_TEST_PASSED';
end
$$;

rollback;
