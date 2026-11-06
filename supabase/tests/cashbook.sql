-- Behavioural test for WP 6.1 (migration *_cashbook_core). Rollback-only, synthetic fixtures.
--   psql "$SUPABASE_DB_URL" -v ON_ERROR_STOP=1 -f supabase/tests/cashbook.sql
-- Callers are simulated with request.jwt.claims + role authenticated. Everything runs in one
-- transaction that ends in `rollback;`; a final tripwire fails loudly if any fixture row persisted.
begin;

do $$
declare
  sa uuid := gen_random_uuid();
  sb uuid := gen_random_uuid();
  u_burs_a uuid := gen_random_uuid();
  u_burs_b uuid := gen_random_uuid();
  u_teacher_a uuid := gen_random_uuid();
  r_burs uuid; r_teacher uuid; v_flag uuid;
  st1 uuid := gen_random_uuid(); st2 uuid := gen_random_uuid(); stb uuid := gen_random_uuid();
  p1 uuid := gen_random_uuid(); p2 uuid := gen_random_uuid(); p3 uuid := gen_random_uuid();
  p4 uuid := gen_random_uuid(); p5 uuid := gen_random_uuid(); pb uuid := gen_random_uuid();
  v_n integer;
begin
  select id into r_burs from roles where name = 'bursar';
  select id into r_teacher from roles where name = 'teacher';
  assert r_burs is not null and r_teacher is not null, 'roles exist';

  insert into auth.users (id, aud, role, email) values
    (u_burs_a, 'authenticated', 'authenticated', 'cashbook-burs-a@example.invalid'),
    (u_burs_b, 'authenticated', 'authenticated', 'cashbook-burs-b@example.invalid'),
    (u_teacher_a, 'authenticated', 'authenticated', 'cashbook-teacher-a@example.invalid');
  insert into schools (id, name, slug, application_number_prefix) values
    (sa, 'Cashbook A', 'cashbook-a', 'CBA'), (sb, 'Cashbook B', 'cashbook-b', 'CBB');
  insert into school_users (auth_user_id, school_id, role_id, full_name, status) values
    (u_burs_a, sa, r_burs, 'Bursar A', 'active'),
    (u_burs_b, sb, r_burs, 'Bursar B', 'active'),
    (u_teacher_a, sa, r_teacher, 'Teacher A', 'active');
  insert into students (id, school_id, first_name, last_name, date_of_birth, gender, status) values
    (st1, sa, 'Sam', 'One', date '2012-01-01', 'male', 'approved'),
    (st2, sa, 'Sue', 'Two', date '2012-01-02', 'female', 'approved'),
    (stb, sb, 'Bea', 'Bee', date '2012-01-03', 'female', 'approved');

  -- School A money in (Kenya is UTC+3):
  --   p1 cash 1000 on 10 Mar; p2 mpesa 2500 at 22:30 UTC on 10 Mar = 01:30 on 11 Mar in Kenya;
  --   p3 mpesa 400 unallocated (no student) on 12 Mar; p4 mpesa 700 PENDING (not money yet);
  --   p5 bank 3000 on 5 Mar, fully reversed on 6 Mar.
  insert into payments (id, school_id, student_id, method, amount, reference, status, recorded_at) values
    (p1, sa, st1, 'cash',  1000, 'R1', 'confirmed',   timestamptz '2026-03-10 09:00+03'),
    (p2, sa, st2, 'mpesa', 2500, 'R2', 'confirmed',   timestamptz '2026-03-10 22:30+00'),
    (p3, sa, null, 'mpesa', 400, 'R3', 'unallocated', timestamptz '2026-03-12 10:00+03'),
    (p4, sa, st1, 'mpesa',  700, 'R4', 'pending',     timestamptz '2026-03-12 11:00+03'),
    (p5, sa, st2, 'bank',  3000, 'R5', 'reversed',    timestamptz '2026-03-05 10:00+03'),
    (pb, sb, stb, 'cash',  7777, 'RB', 'confirmed',   timestamptz '2026-03-10 09:00+03');
  insert into payment_reversals (payment_id, amount, reason, created_at) values
    (p5, 3000, 'test full reversal', timestamptz '2026-03-06 10:00+03'),
    (p2,  500, 'test partial reversal', timestamptz '2026-03-15 10:00+03');
  -- Expenses: approved 800 on 12 Mar; pending and rejected ones are ignored.
  insert into expenses (school_id, category, vendor, amount, status, approved_at) values
    (sa, 'Repairs', 'Vendor', 800, 'approved', timestamptz '2026-03-12 12:00+03'),
    (sa, 'Repairs', 'Vendor', 9999, 'pending', null),
    (sa, 'Repairs', 'Vendor', 5555, 'rejected', null);

  -- 1. no caller: nothing
  execute 'set local role authenticated';
  perform set_config('request.jwt.claims', '{}', true);
  assert (select count(*) from cashbook_entries()) = 0, '1: no caller sees no entries';
  assert (select count(*) from cashbook_summary()) = 0, '1: no caller sees no summary';
  assert (select count(*) from cashbook_reconciliation()) = 0, '1: no caller sees no reconciliation';

  -- 2. flag OFF: bursar sees nothing
  perform set_config('request.jwt.claims', json_build_object('sub', u_burs_a, 'role', 'authenticated')::text, true);
  assert (select count(*) from cashbook_entries()) = 0, '2: flag off => no entries';
  assert (select count(*) from cashbook_summary()) = 0, '2: flag off => no summary';
  assert (select count(*) from cashbook_reconciliation()) = 0, '2: flag off => no reconciliation';

  execute 'reset role';
  select id into v_flag from platform_feature_flags where key = 'feature.finance.cashbook';
  assert v_flag is not null, 'flag catalog entry exists';
  -- Flags are now ON for real schools in production, so a global 'off for everyone' guard is no longer true and says nothing about this test's brand-new fixture schools.
  assert not exists (select 1 from school_feature_flags where flag_id = v_flag and school_id = sa), 'flag is off for the fixture school';
  insert into school_feature_flags (school_id, flag_id, enabled) values (sa, v_flag, true);

  -- 3. teacher (no finance.read) sees nothing even with the flag on
  execute 'set local role authenticated';
  perform set_config('request.jwt.claims', json_build_object('sub', u_teacher_a, 'role', 'authenticated')::text, true);
  assert (select count(*) from cashbook_entries()) = 0, '3: teacher sees no entries';
  assert (select count(*) from cashbook_summary()) = 0, '3: teacher sees no summary';

  -- 4. school B has no flag: bursar B sees nothing
  perform set_config('request.jwt.claims', json_build_object('sub', u_burs_b, 'role', 'authenticated')::text, true);
  assert (select count(*) from cashbook_entries()) = 0, '4: flag off for school B';

  -- 5. bursar A, all time
  perform set_config('request.jwt.claims', json_build_object('sub', u_burs_a, 'role', 'authenticated')::text, true);
  select count(*) into v_n from cashbook_entries();
  assert v_n = 7, '5: 4 receipts + 2 reversals + 1 expense = 7 entries, got ' || v_n;
  assert not exists (select 1 from cashbook_entries() where reference = 'R4'), '5: pending payment is not money';
  assert not exists (select 1 from cashbook_entries() where reference = 'RB'), '5: school B never leaks into school A';
  assert not exists (select 1 from cashbook_entries() where money_in = 9999 or money_out in (9999, 5555)), '5: pending/rejected expenses ignored';
  assert (select entry_date from cashbook_entries() where reference = 'R2' and kind = 'receipt') = date '2026-03-11', '5: Kenya date (01:30 on 11 Mar)';
  assert (select account from cashbook_entries() where kind = 'reversal' and money_out = 500) = 'mpesa', '5: reversal keeps the original method';
  assert (select account from cashbook_entries() where kind = 'expense') = 'unspecified', '5: expenses have no account';
  assert (select array_agg(kind order by entry_at, kind, source_id) from cashbook_entries() where entry_date between date '2026-03-05' and date '2026-03-06') = array['receipt', 'reversal'], '5: date order';

  -- 6. summary, all time
  assert (select closing from cashbook_summary() where account = 'cash') = 1000, '6: cash 1000';
  assert (select closing from cashbook_summary() where account = 'mpesa') = 2400, '6: mpesa 2500+400-500';
  assert (select closing from cashbook_summary() where account = 'bank') = 0, '6: bank received then reversed';
  assert (select closing from cashbook_summary() where account = 'unspecified') = -800, '6: approved expense';
  assert (select sum(closing) from cashbook_summary()) = 2600, '6: total 6900 - 3500 - 800';
  assert (select sum(opening) from cashbook_summary()) = 0, '6: no opening balance without a start date';

  -- 7. summary for a window: opening balances carry the earlier movement
  assert (select opening from cashbook_summary(date '2026-03-11', date '2026-03-12') where account = 'cash') = 1000, '7: cash opening';
  assert (select money_in from cashbook_summary(date '2026-03-11', date '2026-03-12') where account = 'mpesa') = 2900, '7: mpesa in (2500 + 400)';
  assert (select money_out from cashbook_summary(date '2026-03-11', date '2026-03-12') where account = 'mpesa') = 0, '7: the 15 Mar reversal is outside';
  assert (select closing from cashbook_summary(date '2026-03-11', date '2026-03-12') where account = 'mpesa') = 2900, '7: mpesa closing at 12 Mar';
  assert (select opening from cashbook_summary(date '2026-03-11', date '2026-03-12') where account = 'bank') = 0, '7: bank opening nets to zero';
  select count(*) into v_n from cashbook_entries(date '2026-03-10', date '2026-03-12');
  assert v_n = 4, '7: window entries (p1, p2, p3, expense), got ' || v_n;
  assert (select count(*) from cashbook_entries(null, null, 3)) = 3, '7: limit applies';

  -- 8. reconciliation to the raw tables
  assert (select payments_received from cashbook_reconciliation()) = 6900, '8: payments received';
  assert (select receipts_difference from cashbook_reconciliation()) = 0, '8: receipts reconcile';
  assert (select reversals_total from cashbook_reconciliation()) = 3500, '8: reversals total';
  assert (select reversals_difference from cashbook_reconciliation()) = 0, '8: reversals reconcile';
  assert (select approved_expenses from cashbook_reconciliation()) = 800, '8: approved expenses';
  assert (select expenses_difference from cashbook_reconciliation()) = 0, '8: expenses reconcile';

  -- 9. the internal builder cannot be called by clients; anon cannot call anything
  assert not has_function_privilege('authenticated', 'public.cashbook_lines_internal(uuid)', 'execute'), '9: authenticated internal';
  assert not has_function_privilege('anon', 'public.cashbook_lines_internal(uuid)', 'execute'), '9: anon internal';
  assert not has_function_privilege('anon', 'public.cashbook_entries(date,date,integer)', 'execute'), '9: anon entries';
  assert not has_function_privilege('anon', 'public.cashbook_summary(date,date)', 'execute'), '9: anon summary';
  assert not has_function_privilege('anon', 'public.cashbook_reconciliation()', 'execute'), '9: anon reconciliation';
  assert has_function_privilege('authenticated', 'public.cashbook_entries(date,date,integer)', 'execute'), '9: authenticated entries';

  raise notice 'cashbook behavioural checks: all passed';
end
$$;

rollback;

-- Independent tripwire (own implicit transaction after the explicit rollback above).
do $$
begin
  if exists (select 1 from schools where slug in ('cashbook-a', 'cashbook-b'))
     or exists (select 1 from auth.users where email like 'cashbook-%@example.invalid') then
    raise exception 'LEAK DETECTED: cashbook test fixtures were not rolled back -- fix this test file before trusting it again';
  end if;
end
$$;
