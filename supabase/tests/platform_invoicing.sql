-- Behavioural tests for platform invoicing (20261004090000_platform_invoicing.sql).
-- Same safety model as scheme_of_work_rls.sql: synthetic fixtures, impersonation via
-- request.jwt.claims, and everything inside ONE transaction that ends in ROLLBACK, so nothing
-- (including invoice numbers consumed from the counter, or settings changed) persists.
--   psql "$SUPABASE_DB_URL" -v ON_ERROR_STOP=1 -f supabase/tests/platform_invoicing.sql
-- Prints "NOTICE: ... all passed" on success and raises on the first failure.

begin;

create or replace function pg_temp.as_user(p_uid uuid) returns void language plpgsql as $$
begin
  execute 'reset role';
  execute 'set local role authenticated';
  perform set_config('request.jwt.claims', json_build_object('sub', p_uid, 'role', 'authenticated')::text, true);
end $$;

create or replace function pg_temp.as_service() returns void language plpgsql as $$
begin
  execute 'reset role';
  execute 'set local role service_role';
  perform set_config('request.jwt.claims', json_build_object('role', 'service_role')::text, true);
end $$;

create or replace function pg_temp.as_owner() returns void language plpgsql as $$
begin
  execute 'reset role';
  perform set_config('request.jwt.claims', '', true);
end $$;

-- Runs a statement and returns its error message ('' if it succeeded).
create or replace function pg_temp.err(p_sql text) returns text language plpgsql as $$
begin
  execute p_sql;
  return '';
exception when others then
  return sqlerrm;
end $$;

-- Counts array elements of a run_platform_billing_cycle() result that belong to the test schools
-- (a real database also contains real schools, which the run legitimately considers too).
create or replace function pg_temp.cnt(j jsonb, ids uuid[]) returns int language sql as $$
  select count(*)::int from jsonb_array_elements(coalesce(j, '[]'::jsonb)) e where (e->>'school_id')::uuid = any (ids)
$$;

do $$
declare
  sa uuid := gen_random_uuid();  -- school A: active, paying
  sb uuid := gen_random_uuid();  -- school B: active, paying (isolation target)
  st uuid := gen_random_uuid();  -- school T: trial (must never be auto-billed)
  staff uuid := gen_random_uuid();
  own_a uuid := gen_random_uuid();
  own_b uuid := gen_random_uuid();
  prin_a uuid := gen_random_uuid();
  plan_id uuid;
  ay_a uuid := gen_random_uuid();
  ay_b uuid := gen_random_uuid();
  inv1 uuid; inv2 uuid; inv3 uuid; invd uuid; inv_re uuid;
  n1 text; n2 text;
  v_int int; v_num numeric; v_txt text; v_json jsonb; v_bool boolean;
  pay1 uuid;
begin
  select id into plan_id from subscription_plans where code = 'starter';
  if plan_id is null then raise exception 'FIXTURE: starter plan missing'; end if;

  -- ---------- fixtures ----------
  insert into schools (id, name, slug, status, address, email, kra_pin, application_number_prefix) values
    (sa, 'Inv Test School A', 'inv-test-a', 'active', 'P.O. Box 1, Nairobi', 'a@inv.invalid', 'P0000A', 'ITA'),
    (sb, 'Inv Test School B', 'inv-test-b', 'active', 'P.O. Box 2, Mombasa', 'b@inv.invalid', null, 'ITB'),
    (st, 'Inv Test School T', 'inv-test-t', 'trial', null, null, null, 'ITT');
  insert into auth.users (id, aud, role, email) values
    (staff, 'authenticated', 'authenticated', 'inv-staff@example.invalid'),
    (own_a, 'authenticated', 'authenticated', 'inv-owner-a@example.invalid'),
    (own_b, 'authenticated', 'authenticated', 'inv-owner-b@example.invalid'),
    (prin_a, 'authenticated', 'authenticated', 'inv-prin-a@example.invalid');
  insert into school_users (school_id, auth_user_id, role_id, full_name, email) values
    (null, staff, (select id from roles where name = 'super_admin'), 'Inv Staff', 'inv-staff@example.invalid'),
    (sa, own_a, (select id from roles where name = 'school_owner'), 'Inv Owner A', 'inv-owner-a@example.invalid'),
    (sb, own_b, (select id from roles where name = 'school_owner'), 'Inv Owner B', 'inv-owner-b@example.invalid'),
    (sa, prin_a, (select id from roles where name = 'principal'), 'Inv Principal A', 'inv-prin-a@example.invalid');
  insert into school_subscriptions (school_id, plan_id, status, current_period_start, current_period_end) values
    (sa, plan_id, 'active', '2026-01-05', '2027-01-05'),
    (sb, plan_id, 'active', '2026-01-05', '2027-01-05'),
    (st, plan_id, 'trialing', null, null);
  -- school A: 10 active + 3 not billable under the default rule; B: 4 active; T: 2 active
  set local session_replication_role = replica;
  insert into students (school_id, admission_number, first_name, last_name, date_of_birth, gender, status)
    select sa, 'A' || g, 'S', 'T', '2012-01-01', 'male', 'active' from generate_series(1, 10) g;
  insert into students (school_id, admission_number, first_name, last_name, date_of_birth, gender, status) values
    (sa, 'AW1', 'S', 'T', '2012-01-01', 'male', 'withdrawn'), (sa, 'AT1', 'S', 'T', '2012-01-01', 'male', 'transferred'),
    (sa, 'AG1', 'S', 'T', '2012-01-01', 'male', 'graduated');
  insert into students (school_id, admission_number, first_name, last_name, date_of_birth, gender, status)
    select sb, 'B' || g, 'S', 'T', '2012-01-01', 'female', 'active' from generate_series(1, 4) g;
  insert into students (school_id, admission_number, first_name, last_name, date_of_birth, gender, status)
    select st, 'T' || g, 'S', 'T', '2012-01-01', 'female', 'active' from generate_series(1, 2) g;
  set local session_replication_role = origin;

  insert into academic_years (id, school_id, name, start_date, end_date, status) values
    (ay_a, sa, 'IT2026', '2026-01-01', '2026-12-31', 'active'),
    (ay_b, sb, 'IT2026', '2026-01-01', '2026-12-31', 'active');
  insert into terms (school_id, academic_year_id, name, term_number, start_date, end_date, status) values
    -- A: a recently ended term, an old term (outside look-back), a junk "closed" term ending far in the future
    (sa, ay_a, 'Term 2', 2, '2026-05-04', '2026-08-07', 'closed'),
    (sa, ay_a, 'Term 1', 1, '2026-01-05', '2026-04-03', 'closed'),
    (sa, ay_a, 'Junk', 3, '2026-08-17', '2027-12-17', 'closed'),
    -- B: ended term that a manual invoice will overlap
    (sb, ay_b, 'Term 2', 2, '2026-05-04', '2026-08-07', 'closed');

  -- =========================================================
  -- 1. Creation, numbering, calculation
  -- =========================================================
  perform pg_temp.as_user(staff);
  inv1 := create_platform_invoice(sa, '2026-05-04', '2026-08-07', false, null, null, null);
  inv2 := create_platform_invoice(sb, '2026-05-04', '2026-08-07', false, null, null, null);
  select invoice_number into n1 from platform_invoices where id = inv1;
  select invoice_number into n2 from platform_invoices where id = inv2;
  if n1 !~ '^EDC-INV-[0-9]{4}-[0-9]{4,}$' then raise exception 'FAIL: invoice number format: %', n1; end if;
  if split_part(n2, '-', 4)::int <> split_part(n1, '-', 4)::int + 1 then raise exception 'FAIL: numbers not sequential: % then %', n1, n2; end if;

  select student_count, unit_price_kes, amount_kes into v_int, v_num, v_num from platform_invoices where id = inv1;
  if v_int <> 10 then raise exception 'FAIL: billable students should be 10 (active only), got %', v_int; end if;
  if v_num <> (select price_per_student_kes from subscription_plans where id = plan_id) * 10 then raise exception 'FAIL: amount != rate x students: %', v_num; end if;
  select bill_to->>'name', bill_to->>'kra_pin' into v_txt, n1 from platform_invoices where id = inv1;
  if v_txt <> 'Inv Test School A' or n1 <> 'P0000A' then raise exception 'FAIL: bill_to snapshot missing school details'; end if;
  raise notice 'ok: creation, sequential numbering, calculation, snapshot';

  -- Billable-student rule is configurable centrally
  perform set_platform_billing_settings('{"billable_student_statuses":["active","withdrawn"]}'::jsonb);
  inv_re := create_platform_invoice(sa, '2026-09-01', '2026-09-30', true, null, null, null);
  select student_count into v_int from platform_invoices where id = inv_re;
  if v_int <> 11 then raise exception 'FAIL: configurable rule not applied (expected 11, got %)', v_int; end if;
  perform set_platform_billing_settings('{"billable_student_statuses":["active"]}'::jsonb);
  perform cancel_platform_invoice(inv_re, 'test cleanup');
  raise notice 'ok: configurable billable-student rule';

  -- Per-school price override + recurring discount + tax
  perform set_school_billing_terms(sb, 150, 10, 'launch promo', 'billing-b@inv.invalid');
  perform set_platform_billing_settings('{"tax_enabled":true,"tax_label":"VAT","tax_rate_percent":16}'::jsonb);
  invd := create_platform_invoice(sb, '2026-09-01', '2026-09-30', true, 'September 2026', null, null);
  if (select unit_price_kes from platform_invoices where id = invd) <> 150
     or (select subtotal_kes from platform_invoices where id = invd) <> 600
     or (select discount_kes from platform_invoices where id = invd) <> 60
     or (select tax_kes from platform_invoices where id = invd) <> 86.40
     or (select amount_kes from platform_invoices where id = invd) <> 626.40 then
    raise exception 'FAIL: override/discount/tax maths wrong';
  end if;
  perform cancel_platform_invoice(invd, 'test cleanup');
  perform set_platform_billing_settings('{"tax_enabled":false}'::jsonb);
  perform set_school_billing_terms(sb, null, 0, null, null);
  raise notice 'ok: price override, recurring discount, tax';

  -- =========================================================
  -- 2. Duplicate / overlap protection and direct-write guards
  -- =========================================================
  v_txt := pg_temp.err(format('select create_platform_invoice(%L, %L, %L, false)', sa, '2026-05-04', '2026-08-07'));
  if v_txt = '' or v_txt not ilike '%overlapping period%' then raise exception 'FAIL: exact duplicate period accepted/ wrong error: [%]', v_txt; end if;
  v_txt := pg_temp.err(format('select create_platform_invoice(%L, %L, %L, false)', sa, '2026-07-01', '2026-09-01'));
  if v_txt = '' then raise exception 'FAIL: overlapping period accepted'; end if;
  -- adjacent (half-open) period is fine
  inv3 := create_platform_invoice(sa, '2026-08-07', '2026-09-07', true, null, null, null);
  raise notice 'ok: duplicate and overlapping periods rejected; adjacent period allowed';

  -- Direct UPDATE as the super-admin API role: no policy, no privilege
  v_txt := pg_temp.err(format('update platform_invoices set amount_kes = 1 where id = %L', inv1));
  if v_txt = '' and (select amount_kes from platform_invoices where id = inv1) = 1 then raise exception 'FAIL: super admin directly rewrote an invoice amount'; end if;
  v_txt := pg_temp.err(format('delete from platform_invoices where id = %L', inv1));
  if (select count(*) from platform_invoices where id = inv1) <> 1 then raise exception 'FAIL: invoice deleted via API'; end if;
  -- Even the table owner / service role cannot bypass the guard with a direct statement
  perform pg_temp.as_owner();
  -- The guard's allow-flag is transaction-local (each real RPC is its own transaction); this test
  -- is one big transaction, so clear it to behave like a fresh statement from outside.
  perform set_config('educore.invoice_write', '', true);
  v_txt := pg_temp.err(format('update platform_invoices set status = ''paid'' where id = %L', inv1));
  if v_txt not ilike '%only be changed through the invoicing functions%' then raise exception 'FAIL: guard did not block direct status change: [%]', v_txt; end if;
  v_txt := pg_temp.err(format('delete from platform_invoices where id = %L', inv1));
  if v_txt not ilike '%cannot be deleted%' then raise exception 'FAIL: delete not blocked: [%]', v_txt; end if;
  v_txt := pg_temp.err(format('insert into platform_invoices (school_id, subscription_id, period_start, period_end, student_count, amount_kes, due_at, invoice_number, invoice_date, subtotal_kes) select school_id, subscription_id, ''2030-01-01'', ''2030-02-01'', 1, 1, now(), ''X-1'', current_date, 1 from platform_invoices where id = %L', inv1));
  if v_txt not ilike '%through the invoicing functions%' then raise exception 'FAIL: direct insert not blocked: [%]', v_txt; end if;
  -- non-financial columns remain writable (existing send-billing-reminder updates reminder_sent_at)
  v_txt := pg_temp.err(format('update platform_invoices set reminder_sent_at = now() where id = %L', inv1));
  if v_txt <> '' then raise exception 'FAIL: reminder_sent_at update blocked: [%]', v_txt; end if;
  raise notice 'ok: financial columns/deletes/direct inserts blocked; reminder_sent_at still writable';

  -- =========================================================
  -- 3. Tenant isolation (RLS)
  -- =========================================================
  perform pg_temp.as_user(own_a);
  select count(*) into v_int from platform_invoices where school_id = sa and status <> 'draft';
  if v_int < 1 then raise exception 'FAIL: school owner cannot read own issued invoice'; end if;
  select count(*) into v_int from platform_invoices where school_id = sb;
  if v_int <> 0 then raise exception 'FAIL: school A read school B invoices (%)', v_int; end if;
  select count(*) into v_int from platform_invoices where id = inv3;   -- draft of school A
  if v_int <> 0 then raise exception 'FAIL: school can see a DRAFT invoice'; end if;
  select count(*) into v_int from platform_invoice_events;
  if v_int <> 0 then raise exception 'FAIL: school can read the audit trail'; end if;
  select count(*) into v_int from platform_invoice_payments;
  if v_int <> 0 then raise exception 'FAIL: school can read payments ledger'; end if;
  select count(*) into v_int from platform_billing_settings;
  if v_int <> 0 then raise exception 'FAIL: school can read billing settings'; end if;
  v_txt := pg_temp.err(format('select record_platform_invoice_download(%L)', inv2));   -- school B's invoice
  if v_txt = '' then raise exception 'FAIL: school A could log a download of school B''s invoice'; end if;
  perform record_platform_invoice_download(inv1);
  v_txt := pg_temp.err(format('select cancel_platform_invoice(%L, ''hack'')', inv1));
  if v_txt = '' then raise exception 'FAIL: school owner cancelled an invoice'; end if;
  v_txt := pg_temp.err(format('select record_platform_payment(%L, ''x'')', inv1));
  if v_txt = '' then raise exception 'FAIL: school owner recorded a payment'; end if;
  v_txt := pg_temp.err('select run_platform_billing_cycle(false)');
  if v_txt = '' then raise exception 'FAIL: school owner ran the billing cycle'; end if;
  v_txt := pg_temp.err('select set_platform_billing_settings(''{"payment_terms_days":1}'')');
  if v_txt = '' then raise exception 'FAIL: school owner changed billing settings'; end if;

  perform pg_temp.as_user(prin_a);   -- principal lacks billing.read
  select count(*) into v_int from platform_invoices;
  if v_int <> 0 then raise exception 'FAIL: principal without billing.read can read invoices (%)', v_int; end if;

  perform pg_temp.as_user(own_b);
  select count(*) into v_int from platform_invoices where school_id = sa;
  if v_int <> 0 then raise exception 'FAIL: school B read school A invoices'; end if;
  perform pg_temp.as_user(staff);
  select count(*) into v_int from platform_invoices where school_id in (sa, sb);
  if v_int < 3 then raise exception 'FAIL: platform staff cannot see all invoices'; end if;
  select count(*) into v_int from platform_invoice_events where invoice_id = inv1 and event_type = 'downloaded';
  if v_int <> 1 then raise exception 'FAIL: download not audited (%)', v_int; end if;
  raise notice 'ok: tenant isolation, draft invisibility, permission gating';

  -- =========================================================
  -- 4. Payments, partial payments, status transitions
  -- =========================================================
  select amount_kes into v_num from platform_invoices where id = inv1;   -- 1000 at 100/student x 10
  v_txt := pg_temp.err(format('select record_platform_invoice_payment(%L, %s, null, ''mpesa'', ''R1'', null)', inv1, v_num + 1));
  if v_txt not ilike '%exceeds the outstanding balance%' then raise exception 'FAIL: overpayment accepted: [%]', v_txt; end if;
  pay1 := record_platform_invoice_payment(inv1, v_num / 4, null, 'mpesa', 'QWE123', 'first part');
  if (select status from platform_invoices where id = inv1) <> 'partially_paid' then raise exception 'FAIL: partial payment status'; end if;
  if (select balance_kes from platform_invoices where id = inv1) <> (select amount_kes from platform_invoices where id = inv1) * 0.75 then raise exception 'FAIL: balance after partial'; end if;
  -- void the partial and the invoice returns to issued
  perform void_platform_invoice_payment(pay1, 'entered on wrong invoice');
  if (select status from platform_invoices where id = inv1) <> 'issued' or (select amount_paid_kes from platform_invoices where id = inv1) <> 0 then
    raise exception 'FAIL: void did not restore invoice (status %)', (select status from platform_invoices where id = inv1);
  end if;
  v_txt := pg_temp.err(format('select void_platform_invoice_payment(%L, ''again'')', pay1));
  if v_txt = '' then raise exception 'FAIL: payment voided twice'; end if;
  -- legacy-compatible RPC settles the whole balance
  perform record_platform_payment(inv1, 'FULL-1');
  if (select status from platform_invoices where id = inv1) <> 'paid' then raise exception 'FAIL: record_platform_payment did not mark paid'; end if;
  v_txt := pg_temp.err(format('select record_platform_payment(%L, ''again'')', inv1));
  if v_txt = '' then raise exception 'FAIL: paid invoice accepted another payment'; end if;
  v_txt := pg_temp.err(format('select cancel_platform_invoice(%L, ''oops'')', inv1));
  if v_txt = '' then raise exception 'FAIL: paid invoice cancelled'; end if;
  raise notice 'ok: partial payment, void, full payment, overpay and double-pay rejected';

  -- =========================================================
  -- 5. Overdue sweep and the suspension chain
  -- =========================================================
  -- inv2 (school B) issued; make its due date past, plus a draft past due that must NOT flip
  perform set_platform_invoice_due_date(inv2, current_date, 'test: shorten');
  perform pg_temp.as_owner();
  perform set_config('educore.invoice_write', 'on', true);
  update platform_invoices set due_at = now() - interval '20 days' where id in (inv2, inv3);
  perform set_config('educore.invoice_write', '', true);
  perform pg_temp.as_service();
  v_int := mark_invoices_overdue();
  if v_int < 1 then raise exception 'FAIL: overdue sweep flipped nothing'; end if;
  perform pg_temp.as_owner();
  if (select status from platform_invoices where id = inv2) <> 'overdue' then raise exception 'FAIL: issued past-due invoice not overdue'; end if;
  if (select status from platform_invoices where id = inv3) <> 'draft' then raise exception 'FAIL: DRAFT was swept to overdue (would suspend a school)'; end if;
  perform pg_temp.as_service();
  perform suspend_schools_with_overdue_invoices(7);
  perform pg_temp.as_owner();
  if (select status from schools where id = sb) <> 'suspended' then raise exception 'FAIL: overdue chain did not suspend school B'; end if;
  if (select status from schools where id = sa) <> 'active' then raise exception 'FAIL: school A suspended by a draft / paid invoice'; end if;
  -- paying the overdue invoice in full reactivates
  perform pg_temp.as_user(staff);
  perform record_platform_payment(inv2, 'LATE-1');
  perform pg_temp.as_owner();
  if (select status from schools where id = sb) <> 'active' then raise exception 'FAIL: payment did not reactivate school B'; end if;
  raise notice 'ok: overdue sweep ignores drafts; suspension chain intact; payment reactivates';

  -- =========================================================
  -- 6. Lifecycle: issue draft, adjust, due date, cancel, reissue
  -- =========================================================
  perform pg_temp.as_user(staff);
  perform issue_platform_invoice(inv3);
  if (select status from platform_invoices where id = inv3) <> 'issued' or (select issued_at from platform_invoices where id = inv3) is null then raise exception 'FAIL: issue draft'; end if;
  v_txt := pg_temp.err(format('select issue_platform_invoice(%L)', inv3));
  if v_txt = '' then raise exception 'FAIL: issued invoice issued twice'; end if;
  perform adjust_platform_invoice(inv3, 100, 'goodwill');
  if (select amount_kes from platform_invoices where id = inv3) <> (select subtotal_kes from platform_invoices where id = inv3) - 100 then raise exception 'FAIL: adjustment total'; end if;
  v_txt := pg_temp.err(format('select adjust_platform_invoice(%L, 1, '''')', inv3));
  if v_txt = '' then raise exception 'FAIL: adjustment without reason accepted'; end if;
  perform mark_platform_invoice_sent(inv3, 'billing@a.invalid');
  if (select status from platform_invoices where id = inv3) <> 'sent' then raise exception 'FAIL: sent status'; end if;
  inv_re := reissue_platform_invoice(inv3, 'student count corrected');
  if (select status from platform_invoices where id = inv3) <> 'cancelled' then raise exception 'FAIL: reissue did not cancel original'; end if;
  if (select replaces_invoice_id from platform_invoices where id = inv_re) <> inv3 then raise exception 'FAIL: reissue link'; end if;
  if (select invoice_number from platform_invoices where id = inv_re) = (select invoice_number from platform_invoices where id = inv3) then raise exception 'FAIL: reissue reused number'; end if;
  v_int := regenerate_platform_invoice_pdf(inv_re);
  if v_int <> 2 then raise exception 'FAIL: pdf_version after regenerate (%)', v_int; end if;
  v_txt := pg_temp.err(format('select cancel_platform_invoice(%L, '''')', inv_re));
  if v_txt = '' then raise exception 'FAIL: cancel without reason'; end if;
  perform cancel_platform_invoice(inv_re, 'test over');
  -- audit trail for the reissued chain
  select count(*) into v_int from platform_invoice_events where invoice_id = inv3 and event_type in ('created', 'issued', 'adjusted', 'sent', 'reissued', 'cancelled');
  if v_int < 6 then raise exception 'FAIL: audit trail incomplete for inv3 (% events)', v_int; end if;
  perform pg_temp.as_owner();
  v_txt := pg_temp.err(format('update platform_invoice_events set event_type = ''created'' where invoice_id = %L', inv3));
  if v_txt not ilike '%append-only%' then raise exception 'FAIL: audit trail is mutable: [%]', v_txt; end if;
  raise notice 'ok: issue / adjust / sent / reissue / regenerate / cancel + append-only audit';

  -- =========================================================
  -- 7. Automation: planner + runner
  -- =========================================================
  perform pg_temp.as_user(staff);
  -- clear out manual invoices for the automation scenarios
  perform pg_temp.as_owner();
  set local session_replication_role = replica;   -- fixture cleanup only
  delete from platform_invoice_payments where school_id in (sa, sb);
  delete from platform_invoice_events where school_id in (sa, sb);
  update platform_invoices set replaces_invoice_id = null where school_id in (sa, sb);
  delete from platform_invoices where school_id in (sa, sb);
  set local session_replication_role = origin;
  perform pg_temp.as_service();

  -- disabled => the scheduled run is a no-op
  v_json := run_platform_billing_cycle(false, 'cron', '2026-08-20');
  if (v_json->>'ran')::boolean is not false then raise exception 'FAIL: cron ran while auto_generate_enabled=false: %', v_json; end if;
  if exists (select 1 from platform_invoices where school_id in (sa, sb)) then raise exception 'FAIL: invoices created while disabled'; end if;

  -- cannot enable without an explicit effective date
  perform pg_temp.as_user(staff);
  v_txt := pg_temp.err('select set_platform_billing_settings(''{"auto_generate_enabled":true}'')');
  if v_txt = '' then raise exception 'FAIL: auto-billing enabled without effective date'; end if;
  perform set_platform_billing_settings('{"auto_generate_enabled":true,"auto_effective_from":"2026-08-01","auto_lookback_days":45}'::jsonb);

  -- dry run shows exactly what would happen and writes nothing
  v_json := run_platform_billing_cycle(true, 'manual', '2026-08-20');
  if pg_temp.cnt(v_json->'would_create', array[sa, sb]) <> 2 then raise exception 'FAIL: dry run expected 2 candidates (A and B Term 2): %', v_json; end if;
  if exists (select 1 from platform_invoices where school_id in (sa, sb)) then raise exception 'FAIL: dry run wrote invoices'; end if;
  -- trial school, A's old Term 1 (before effective date/look-back) and A's junk future-dated term are never candidates
  if exists (select 1 from plan_platform_billing_cycle('2026-08-20') where school_id = st) then raise exception 'FAIL: trial school is a billing candidate'; end if;
  if exists (select 1 from plan_platform_billing_cycle('2026-08-20') p join terms t on t.id = p.term_id where t.name in ('Term 1', 'Junk') and p.school_id = sa) then
    raise exception 'FAIL: out-of-window or future-dated term considered for billing';
  end if;

  -- real run creates DRAFTS, with the term as the billing period and a descriptive label
  perform pg_temp.as_service();
  v_json := run_platform_billing_cycle(false, 'cron', '2026-08-20');
  if pg_temp.cnt(v_json->'created', array[sa, sb]) <> 2 or v_json->>'status_on_create' <> 'draft' then raise exception 'FAIL: run result: %', v_json; end if;
  if (select count(*) from platform_invoices where school_id in (sa, sb) and status = 'draft' and source = 'auto') <> 2 then raise exception 'FAIL: auto invoices not drafts'; end if;
  if (select billing_period_label from platform_invoices where school_id = sa) <> 'Term 2 2026' then raise exception 'FAIL: label %', (select billing_period_label from platform_invoices where school_id = sa); end if;
  if (select period_start || '/' || period_end from platform_invoices where school_id = sa) <> '2026-05-04/2026-08-07' then raise exception 'FAIL: period not the term'; end if;

  -- idempotent: running again (and again, concurrently-ish) creates nothing new
  v_json := run_platform_billing_cycle(false, 'cron', '2026-08-20');
  if pg_temp.cnt(v_json->'created', array[sa, sb]) <> 0 then raise exception 'FAIL: duplicate auto invoices: %', v_json; end if;
  v_json := run_platform_billing_cycle(false, 'cron', '2026-08-25');
  if pg_temp.cnt(v_json->'created', array[sa, sb]) <> 0 or (select count(*) from platform_invoices where school_id in (sa, sb)) <> 2 then raise exception 'FAIL: not idempotent'; end if;

  -- a manual invoice overlapping a term makes automation skip (and say why), not collide
  perform pg_temp.as_owner();
  set local session_replication_role = replica;
  delete from platform_invoice_events where school_id = sb;
  delete from platform_invoices where school_id = sb;
  set local session_replication_role = origin;
  perform pg_temp.as_user(staff);
  perform create_platform_invoice(sb, '2026-07-15', '2026-08-15', true, null, null, null);
  v_json := run_platform_billing_cycle(false, 'manual', '2026-08-20');
  if pg_temp.cnt(v_json->'created', array[sa, sb]) <> 0 then raise exception 'FAIL: auto created over a manual invoice: %', v_json; end if;
  if not exists (select 1 from jsonb_array_elements(v_json->'skipped') e where (e->>'school_id')::uuid = sb and e->>'reason' = 'overlaps_existing_invoice') then raise exception 'FAIL: skip reason missing: %', v_json; end if;

  -- auto_issue + auto_send flags: issued on creation; send requires issue
  v_txt := pg_temp.err('select set_platform_billing_settings(''{"auto_issue":false,"auto_send":true}'')');
  if v_txt = '' then raise exception 'FAIL: auto_send allowed without auto_issue'; end if;
  perform pg_temp.as_owner();
  set local session_replication_role = replica;
  delete from platform_invoice_events where school_id = sa;
  delete from platform_invoices where school_id in (sa, sb);
  set local session_replication_role = origin;
  perform pg_temp.as_user(staff);
  perform set_platform_billing_settings('{"auto_issue":true}'::jsonb);
  v_json := run_platform_billing_cycle(false, 'manual', '2026-08-20');
  if (select count(*) from platform_invoices where school_id in (sa, sb) and status = 'issued') <> 2 then raise exception 'FAIL: auto_issue did not issue: %', v_json; end if;
  raise notice 'ok: automation gates, dry-run, drafts, idempotency, overlap-skip, auto_issue';

  -- =========================================================
  -- 8. Settings validation
  -- =========================================================
  v_txt := pg_temp.err('select set_platform_billing_settings(''{"payment_instructions":{"evil_field":"x"}}'')');
  if v_txt not ilike '%Unknown payment instruction field%' then raise exception 'FAIL: unknown instruction key accepted: [%]', v_txt; end if;
  v_txt := pg_temp.err('select set_platform_billing_settings(''{"invoice_prefix":"bad prefix!"}'')');
  if v_txt = '' then raise exception 'FAIL: invalid prefix accepted'; end if;
  perform set_platform_billing_settings('{"payment_instructions":{"mpesa_paybill":"123456","bank_name":"Test Bank","account_number":"000111","other_instructions":"Quote the invoice number."}}'::jsonb);
  select payment_instructions into v_json from platform_billing_settings;
  if v_json->>'mpesa_paybill' <> '123456' then raise exception 'FAIL: payment instructions not stored'; end if;
  perform set_platform_billing_settings('{"payment_instructions":{}}'::jsonb);
  select payment_instructions into v_json from platform_billing_settings;
  if v_json <> '{}'::jsonb then raise exception 'FAIL: payment instructions not clearable'; end if;
  raise notice 'ok: settings validation';

  raise notice 'platform invoicing behavioural checks: all passed';
end $$;

rollback;

do $$
begin
  if exists (select 1 from schools where slug in ('inv-test-a', 'inv-test-b', 'inv-test-t')) then
    raise exception 'LEAK DETECTED: invoicing test fixtures were not rolled back';
  end if;
end $$;
