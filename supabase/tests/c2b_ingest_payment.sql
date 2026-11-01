-- Behavioral test for the Phase 1.1a C2B ingest core (migration 20261031203000_c2b_ingest_core).
-- Rollback-only, synthetic fixtures (two throwaway schools); touches no real school's data.
--   psql "$SUPABASE_DB_URL" -v ON_ERROR_STOP=1 -f supabase/tests/c2b_ingest_payment.sql
-- Not wired to a pull_request workflow because it needs the migration already deployed.
-- Run it after the migration is live (and re-run after any later change to these functions).
begin;

do $$
declare
  sa uuid := gen_random_uuid();
  sb uuid := gen_random_uuid();
  ay uuid := gen_random_uuid();
  term uuid := gen_random_uuid();
  s1 uuid; s2 uuid; sx1 uuid; sxl uuid; sab1 uuid; sab2 uuid;
  v_flag_id uuid;
  inv1 uuid;
  r jsonb;
  v_n int;
  v_num numeric;
  v_txt text;
  v_pay uuid;
  v_blocked boolean;
begin
  select id into v_flag_id from platform_feature_flags where lower(key) = 'feature.finance.c2b_capture';
  assert v_flag_id is not null, 'flag catalog row exists';
  assert not exists (select 1 from school_feature_flags where school_feature_flags.flag_id = v_flag_id and enabled), 'flag is enabled for nobody';

  -- ---------- fixtures ----------
  insert into schools (id, name, slug, application_number_prefix) values
    (sa, 'C2B Test A', 'c2b-test-a', 'CTA'), (sb, 'C2B Test B', 'c2b-test-b', 'CTB');
  insert into academic_years (id, school_id, name, start_date, end_date) values (ay, sa, 'C2B Year', '2026-01-01', '2026-12-31');
  insert into terms (id, school_id, academic_year_id, name, term_number, start_date, end_date) values
    (term, sa, ay, 'C2B Term', 1, '2026-01-01', '2026-04-01');

  insert into students (school_id, admission_number, first_name, last_name, date_of_birth, gender, status) values
    (sa, '001', 'S', 'One', date '2015-01-01', 'male', 'approved') returning id into s1;
  insert into students (school_id, admission_number, first_name, last_name, date_of_birth, gender, status) values
    (sa, '002', 'S', 'Two', date '2015-01-01', 'female', 'approved') returning id into s2;
  insert into students (school_id, admission_number, first_name, last_name, date_of_birth, gender, status) values
    (sa, 'X1', 'S', 'X1', date '2015-01-01', 'male', 'approved') returning id into sx1;
  insert into students (school_id, admission_number, first_name, last_name, date_of_birth, gender, status) values
    (sa, 'XL', 'S', 'XL', date '2015-01-01', 'male', 'approved') returning id into sxl;
  insert into students (school_id, admission_number, first_name, last_name, date_of_birth, gender, status) values
    (sa, 'AB1', 'S', 'AB1', date '2015-01-01', 'male', 'approved') returning id into sab1;
  insert into students (school_id, admission_number, first_name, last_name, date_of_birth, gender, status) values
    (sa, 'AB-1', 'S', 'AB2', date '2015-01-01', 'male', 'approved') returning id into sab2;

  insert into invoices (school_id, student_id, term_id, total_amount) values (sa, s1, term, 5000) returning id into inv1;

  -- ---------- 1. helpers ----------
  assert c2b_normalize_ref('  ab-1 ') = 'AB1', 'normalize strips spaces and hyphens, uppercases';
  assert c2b_canonical_ref('o01') = '1', 'canonical: O->0, digits-only drops leading zeros';
  assert c2b_canonical_ref('XL') = 'X1', 'canonical: L->1';
  assert c2b_canonical_ref('GH/001') = 'GH/001', 'canonical leaves non-digit references alone apart from the swaps';

  -- ---------- 2. input validation ----------
  begin perform c2b_ingest_payment(sa, 'mpesa_c2b', 'T1', 0, '001'); assert false, 'zero amount accepted'; exception when others then assert sqlerrm = 'Invalid amount.', 'zero amount: ' || sqlerrm; end;
  begin perform c2b_ingest_payment(sa, 'mpesa_c2b', '   ', 10, '001'); assert false, 'blank id accepted'; exception when others then assert sqlerrm = 'Invalid external id.', 'blank id: ' || sqlerrm; end;
  begin perform c2b_ingest_payment(sa, 'bogus', 'T1', 10, '001'); assert false, 'bad provider accepted'; exception when others then assert sqlerrm = 'Unsupported provider.', 'bad provider: ' || sqlerrm; end;
  begin perform c2b_ingest_payment(gen_random_uuid(), 'mpesa_c2b', 'T1', 10, '001'); assert false, 'unknown school accepted'; exception when others then assert sqlerrm = 'School not found.', 'unknown school: ' || sqlerrm; end;

  -- ---------- 3. flag off: event logged with the would-be plan, no money moved ----------
  r := c2b_ingest_payment(sa, 'mpesa_c2b', 'ABC1000001', 3000, '001', '2547*****126', now());
  assert r->>'outcome' = 'log_only' and r->>'would_be' = 'allocate' and r->>'match_rule' = 'exact', 'flag off: log_only/allocate/exact, got ' || r::text;
  assert not exists (select 1 from payments where school_id = sa), 'flag off: no payment created';
  assert exists (select 1 from inbound_payment_events where school_id = sa and external_id = 'ABC1000001' and notes like '%flag_off%'), 'flag off noted';

  -- ---------- 4. flag on but default log-only mode: still no money moved ----------
  insert into school_feature_flags (school_id, flag_id, enabled) values (sa, v_flag_id, true);
  r := c2b_ingest_payment(sa, 'mpesa_c2b', 'ABC1000002', 3000, '001');
  assert r->>'outcome' = 'log_only', 'flag on, no config row -> log_only, got ' || r::text;
  insert into mpesa_c2b_config (school_id) values (sa);
  assert (select mode from mpesa_c2b_config where school_id = sa) = 'log_only', 'config defaults to log_only';
  r := c2b_ingest_payment(sa, 'mpesa_c2b', 'ABC1000003', 3000, '001');
  assert r->>'outcome' = 'log_only', 'flag on, mode log_only -> log_only';
  assert not exists (select 1 from payments where school_id = sa), 'log-only: still no payment';

  -- ---------- 5. live: exact match allocates and receipts ----------
  update mpesa_c2b_config set mode = 'live' where school_id = sa;
  r := c2b_ingest_payment(sa, 'mpesa_c2b', 'LIVE000001', 3000, ' 001 ', '2547*****126', now());
  assert r->>'outcome' = 'allocated' and r->>'match_rule' = 'exact' and (r->>'student_id')::uuid = s1, 'live exact allocated, got ' || r::text;
  v_pay := (r->>'payment_id')::uuid;
  assert (select status from payments where id = v_pay) = 'confirmed', 'payment confirmed';
  assert (select source from payments where id = v_pay) = 'api' and (select external_provider from payments where id = v_pay) = 'mpesa_c2b', 'api/mpesa_c2b';
  assert (select coalesce(sum(amount_allocated), 0) from payment_allocations where payment_id = v_pay) = 3000, 'allocated 3000';
  assert exists (select 1 from receipts where payment_id = v_pay), 'receipt generated';
  assert (select status from invoices where id = inv1) = 'partially_paid', 'invoice partially paid';

  -- ---------- 6. idempotency ----------
  r := c2b_ingest_payment(sa, 'mpesa_c2b', 'live000001', 3000, '001');  -- same id, different case
  assert (r->>'duplicate')::boolean and r->>'outcome' = 'allocated', 'redelivery returns the original result';
  assert (select count(*) from payments where school_id = sa and reference = 'LIVE000001') = 1, 'still exactly one payment';

  -- ---------- 7. typo repair, unique match: leading zeros; overpayment keeps the excess ----------
  r := c2b_ingest_payment(sa, 'mpesa_c2b', 'LIVE000002', 4000, '1');
  assert r->>'outcome' = 'allocated' and r->>'match_rule' = 'typo_repair' and (r->>'student_id')::uuid = s1, 'typo repair via leading zeros, got ' || r::text;
  v_pay := (r->>'payment_id')::uuid;
  assert (select amount from payments where id = v_pay) = 4000, 'full amount recorded';
  assert (select coalesce(sum(amount_allocated), 0) from payment_allocations where payment_id = v_pay) = 2000, 'only the outstanding 2000 allocated; excess stays as credit';
  assert (select status from invoices where id = inv1) = 'paid', 'invoice now paid';

  -- ---------- 8. matched learner with nothing outstanding: unallocated but tied to the learner ----------
  r := c2b_ingest_payment(sa, 'mpesa_c2b', 'LIVE000003', 500, 'O01');
  assert r->>'outcome' = 'unallocated' and r->>'match_rule' = 'typo_repair' and (r->>'student_id')::uuid = s1, 'O/0 repair, nothing outstanding, got ' || r::text;
  assert (select status from payments where id = (r->>'payment_id')::uuid) = 'unallocated', 'payment unallocated';
  assert (select student_id from payments where id = (r->>'payment_id')::uuid) = s1, 'payment remembers the matched learner';

  -- ---------- 9. never guess ----------
  r := c2b_ingest_payment(sa, 'mpesa_c2b', 'LIVE000004', 100, 'XI');   -- canonical X1 matches X1 and XL
  assert r->>'outcome' = 'unallocated' and r->>'match_rule' = 'ambiguous' and r->>'student_id' is null, 'two repair candidates -> ambiguous, got ' || r::text;
  r := c2b_ingest_payment(sa, 'mpesa_c2b', 'LIVE000005', 100, 'AB1');  -- normalises equal to AB1 and AB-1
  assert r->>'outcome' = 'unallocated' and r->>'match_rule' = 'ambiguous', 'two exact candidates -> ambiguous, got ' || r::text;
  r := c2b_ingest_payment(sa, 'mpesa_c2b', 'LIVE000006', 100, 'ZZZ999');
  assert r->>'outcome' = 'unallocated' and r->>'match_rule' = 'none', 'no match -> none';
  r := c2b_ingest_payment(sa, 'mpesa_c2b', 'LIVE000007', 100, null);
  assert r->>'outcome' = 'unallocated' and r->>'match_rule' = 'none', 'no reference -> none';
  r := c2b_ingest_payment(sa, 'mpesa_c2b', 'LIVE000008', 100, '12');   -- not a repair of 001/002
  assert r->>'outcome' = 'unallocated' and r->>'match_rule' = 'none', 'partial/other numbers are not repaired';
  assert (select student_id from payments where reference = 'LIVE000004') is null, 'ambiguous payment has no learner';

  -- ---------- 10. tenant isolation ----------
  r := c2b_ingest_payment(sb, 'mpesa_c2b', 'LIVE000009', 100, '001');
  assert r->>'outcome' = 'log_only', 'school B has no flag: log_only';
  insert into school_feature_flags (school_id, flag_id, enabled) values (sb, v_flag_id, true);
  insert into mpesa_c2b_config (school_id, mode) values (sb, 'live');
  r := c2b_ingest_payment(sb, 'mpesa_c2b', 'LIVE000010', 100, '001');
  assert r->>'outcome' = 'unallocated' and r->>'match_rule' = 'none', 'school B cannot match school A''s learner';
  assert (select school_id from payments where reference = 'LIVE000010') = sb, 'payment belongs to school B';
  -- the same TransID in two schools is two separate events
  r := c2b_ingest_payment(sa, 'mpesa_c2b', 'SHARED0001', 100, 'ZZZ');
  r := c2b_ingest_payment(sb, 'mpesa_c2b', 'SHARED0001', 100, 'ZZZ');
  assert (select count(*) from inbound_payment_events where external_id = 'SHARED0001') = 2, 'event key is per school';

  -- ---------- 11. duplicates against existing payments (STK path, reversed payments) ----------
  insert into payments (school_id, student_id, method, amount, reference, status, source, external_provider)
    values (sa, s2, 'mpesa', 250, 'STKREC0001', 'confirmed', 'api', 'mpesa_daraja');
  r := c2b_ingest_payment(sa, 'mpesa_c2b', 'stkrec0001', 250, '002');
  assert r->>'outcome' = 'duplicate', 'receipt already recorded by STK -> duplicate, got ' || r::text;
  assert (select count(*) from payments where school_id = sa and reference = 'STKREC0001') = 1, 'no second payment';
  insert into payments (school_id, student_id, method, amount, reference, status, source, external_provider)
    values (sa, s2, 'mpesa', 260, 'REVERSED001', 'reversed', 'api', 'mpesa_daraja');
  r := c2b_ingest_payment(sa, 'mpesa_c2b', 'REVERSED001', 260, '002');
  assert r->>'outcome' = 'duplicate', 'reversed payment reference is not re-recorded, got ' || r::text;

  -- ---------- 12. pending STK request: defer, then resolve ----------
  insert into mpesa_stk_requests (school_id, student_id, amount, phone_number, status, initiated_at)
    values (sa, s2, 777, '254700000000', 'pending', now());
  r := c2b_ingest_payment(sa, 'mpesa_c2b', 'DEFER00001', 777, '002');
  assert r->>'outcome' = 'deferred_to_stk' and r->>'payment_id' is null, 'matching pending STK -> deferred, got ' || r::text;
  assert not exists (select 1 from payments where reference = 'DEFER00001'), 'deferred: nothing recorded yet';
  assert c2b_resolve_deferred_events(interval '1 hour') = 0, 'too-young deferred events are left alone';
  -- now() is frozen inside one transaction, so age the event artificially
  update inbound_payment_events set created_at = created_at - interval '1 hour' where outcome = 'deferred_to_stk';
  v_n := c2b_resolve_deferred_events(interval '20 minutes');
  assert v_n = 1, 'one deferred event resolved, got ' || v_n;
  assert (select outcome from inbound_payment_events where external_id = 'DEFER00001') = 'unallocated', 'resolved: STK never recorded it, so it is recorded (learner has no invoice)';
  assert (select student_id from payments where reference = 'DEFER00001') = s2, 'resolved payment tied to the matched learner';
  -- if the STK path did record it in the meantime, resolution just closes the event
  r := c2b_ingest_payment(sa, 'mpesa_c2b', 'DEFER00002', 777, '002');
  assert r->>'outcome' = 'deferred_to_stk', 'deferred again';
  insert into payments (school_id, student_id, method, amount, reference, status, source, external_provider)
    values (sa, s2, 'mpesa', 777, 'DEFER00002', 'confirmed', 'api', 'mpesa_daraja');
  update inbound_payment_events set created_at = created_at - interval '1 hour' where outcome = 'deferred_to_stk';
  perform c2b_resolve_deferred_events(interval '20 minutes');
  assert (select outcome from inbound_payment_events where external_id = 'DEFER00002') = 'duplicate', 'STK recorded it -> event closed as duplicate';
  assert (select count(*) from payments where reference = 'DEFER00002') = 1, 'still one payment';

  -- ---------- 13. audit trail ----------
  assert (select count(*) from audit_log where school_id = sa and table_name = 'payments' and new_data->>'source' = 'inbound_payment_event') >= 5, 'each recorded payment has an audit row';

  -- ---------- 14. grants and exposure ----------
  assert not has_function_privilege('anon', 'c2b_ingest_payment(uuid,text,text,numeric,text,text,timestamptz)', 'execute'), 'anon cannot ingest';
  assert not has_function_privilege('authenticated', 'c2b_ingest_payment(uuid,text,text,numeric,text,text,timestamptz)', 'execute'), 'authenticated cannot ingest';
  assert not has_function_privilege('authenticated', 'c2b_process_event(uuid,boolean)', 'execute'), 'authenticated cannot process';
  assert not has_function_privilege('authenticated', 'c2b_resolve_deferred_events(interval)', 'execute'), 'authenticated cannot resolve';
  assert has_function_privilege('service_role', 'c2b_ingest_payment(uuid,text,text,numeric,text,text,timestamptz)', 'execute'), 'service_role can ingest';
  assert not has_table_privilege('authenticated', 'mpesa_c2b_config', 'select'), 'config (URL secret) unreadable by authenticated';
  assert not has_table_privilege('anon', 'inbound_payment_events', 'select'), 'anon cannot read events';
  assert has_table_privilege('authenticated', 'inbound_payment_events', 'select'), 'authenticated may read events through RLS';
  assert not has_table_privilege('authenticated', 'inbound_payment_events', 'insert'), 'authenticated cannot write events';
  assert not has_table_privilege('authenticated', 'inbound_payment_events', 'update'), 'authenticated cannot update events';

  -- ---------- 15. nothing leaked into audit_log from the config secret ----------
  assert not exists (select 1 from audit_log where table_name = 'mpesa_c2b_config'), 'config has no audit trigger, so its token is never copied to audit_log';

  raise notice 'c2b_ingest_payment: all assertions passed';
end $$;

rollback;
