-- Behavioural tests for permanent invoice deletion (20261017133000_platform_invoice_permanent_delete.sql).
-- Same safety model as platform_invoicing.sql: synthetic fixtures, impersonation via
-- request.jwt.claims, and everything inside ONE transaction that ends in ROLLBACK, so nothing
-- (including invoice numbers consumed from the counter) persists.
--   psql "$SUPABASE_DB_URL" -v ON_ERROR_STOP=1 -f supabase/tests/platform_invoice_permanent_delete.sql
-- Prints "NOTICE: ... all passed" on success and raises on the first failure.

begin;

-- aal2 is included so the test also passes once admin MFA enforcement is switched on.
create or replace function pg_temp.as_user(p_uid uuid) returns void language plpgsql as $$
begin
  execute 'reset role';
  execute 'set local role authenticated';
  perform set_config('request.jwt.claims', json_build_object('sub', p_uid, 'role', 'authenticated', 'aal', 'aal2')::text, true);
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

do $$
declare
  sa uuid := gen_random_uuid();
  staff uuid := gen_random_uuid();
  own_a uuid := gen_random_uuid();
  plan_id uuid;
  inv1 uuid; inv2 uuid; inv3 uuid; inv4 uuid; inv5 uuid;
  n1 text; n2 text;
  seq1 int; seq2 int;
  v_int int; v_txt text; v_json jsonb;
begin
  select id into plan_id from subscription_plans where code = 'starter';
  if plan_id is null then raise exception 'FIXTURE: starter plan missing'; end if;

  insert into schools (id, name, slug, status, address, email, application_number_prefix)
    values (sa, 'Del Test School A', 'del-test-a', 'active', 'P.O. Box 1, Nairobi', 'a@del.invalid', 'DTA');
  insert into auth.users (id, aud, role, email) values
    (staff, 'authenticated', 'authenticated', 'del-staff@example.invalid'),
    (own_a, 'authenticated', 'authenticated', 'del-owner-a@example.invalid');
  insert into school_users (school_id, auth_user_id, role_id, full_name, email) values
    (null, staff, (select id from roles where name = 'super_admin'), 'Del Staff', 'del-staff@example.invalid'),
    (sa, own_a, (select id from roles where name = 'school_owner'), 'Del Owner A', 'del-owner-a@example.invalid');
  insert into school_subscriptions (school_id, plan_id, status, current_period_start, current_period_end)
    values (sa, plan_id, 'active', '2026-01-05', '2027-01-05');
  set local session_replication_role = replica;
  insert into students (school_id, admission_number, first_name, last_name, date_of_birth, gender, status)
    select sa, 'D' || g, 'S', 'T', '2012-01-01', 'male', 'active' from generate_series(1, 3) g;
  set local session_replication_role = origin;

  perform pg_temp.as_user(staff);
  inv1 := create_platform_invoice(sa, '2026-05-04', '2026-08-07', false, null, null, null);
  inv2 := create_platform_invoice(sa, '2026-09-01', '2026-09-30', false, null, null, null);
  select invoice_number into n1 from platform_invoices where id = inv1;
  select invoice_number into n2 from platform_invoices where id = inv2;
  seq1 := split_part(n1, '-', 4)::int;
  seq2 := split_part(n2, '-', 4)::int;
  perform record_platform_invoice_payment(inv2, 100, null, 'mpesa', 'TESTREF1', null);

  -- =========================================================
  -- 1. Nothing else can delete: the guards still hold
  -- =========================================================
  perform pg_temp.as_owner();
  v_txt := pg_temp.err(format('delete from platform_invoices where id = %L', inv2));
  if v_txt not ilike '%cannot be deleted%' then raise exception 'FAIL: direct invoice delete not blocked: [%]', v_txt; end if;
  v_txt := pg_temp.err(format('delete from platform_invoice_events where invoice_id = %L', inv2));
  if v_txt not ilike '%append-only%' then raise exception 'FAIL: direct history delete not blocked: [%]', v_txt; end if;
  raise notice 'ok: direct deletes still blocked';

  -- =========================================================
  -- 2. Authorization and confirmation
  -- =========================================================
  perform pg_temp.as_user(own_a);
  v_txt := pg_temp.err(format('select delete_platform_invoice_permanently(%L, %L, ''hack'')', inv2, n2));
  if v_txt not ilike '%Not authorized%' then raise exception 'FAIL: school owner could reach delete: [%]', v_txt; end if;
  perform pg_temp.as_user(staff);
  v_txt := pg_temp.err(format('select delete_platform_invoice_permanently(%L, %L, ''test'')', inv2, n1));
  if v_txt not ilike '%does not match%' then raise exception 'FAIL: wrong confirmation number accepted: [%]', v_txt; end if;
  v_txt := pg_temp.err(format('select delete_platform_invoice_permanently(%L, %L, '''')', inv2, n2));
  if v_txt not ilike '%reason is required%' then raise exception 'FAIL: delete without reason accepted: [%]', v_txt; end if;
  v_txt := pg_temp.err(format('select delete_platform_invoice_permanently(%L, %L, ''test'')', gen_random_uuid(), n2));
  if v_txt not ilike '%not found%' then raise exception 'FAIL: unknown invoice not rejected: [%]', v_txt; end if;
  if (select count(*) from platform_invoices where id in (inv1, inv2)) <> 2 then raise exception 'FAIL: a rejected delete removed something'; end if;
  raise notice 'ok: authorization, confirmation number, reason, not-found';

  -- =========================================================
  -- 3. Delete a paid-into, never-sent invoice that holds the newest number
  -- =========================================================
  v_json := delete_platform_invoice_permanently(inv2, n2, 'trial invoice created by mistake');
  if v_json->>'invoice_number' <> n2 or (v_json->>'payments_deleted')::int <> 1 or (v_json->>'history_rows_deleted')::int < 3
     or (v_json->>'was_sent')::boolean or not (v_json->>'number_reusable')::boolean or v_json->>'school_name' <> 'Del Test School A' then
    raise exception 'FAIL: snapshot wrong: %', v_json;
  end if;
  perform pg_temp.as_owner();
  if exists (select 1 from platform_invoices where id = inv2)
     or exists (select 1 from platform_invoice_payments where invoice_id = inv2)
     or exists (select 1 from platform_invoice_events where invoice_id = inv2) then
    raise exception 'FAIL: invoice, payments or history survived the delete';
  end if;
  if (select last_value from platform_invoice_counters where year = split_part(n2, '-', 3)::int) <> seq1 then
    raise exception 'FAIL: counter not given back after deleting the newest never-sent invoice';
  end if;
  if not exists (select 1 from platform_invoices where id = inv1) then raise exception 'FAIL: unrelated invoice deleted'; end if;
  raise notice 'ok: delete removes invoice + payments + history, snapshot returned, number given back';

  -- the flag must not outlive the call: guards are intact again
  v_txt := pg_temp.err(format('delete from platform_invoices where id = %L', inv1));
  if v_txt not ilike '%cannot be deleted%' then raise exception 'FAIL: delete guard left open after the function: [%]', v_txt; end if;
  raise notice 'ok: guard re-armed after delete';

  -- =========================================================
  -- 4. A sent invoice keeps its number retired (no reuse)
  -- =========================================================
  perform pg_temp.as_user(staff);
  perform mark_platform_invoice_sent(inv1, 'WhatsApp');
  v_json := delete_platform_invoice_permanently(inv1, n1, 'delivered but not owed');
  if not (v_json->>'was_sent')::boolean or (v_json->>'number_reusable')::boolean then raise exception 'FAIL: sent invoice flagged reusable: %', v_json; end if;
  perform pg_temp.as_owner();
  if (select last_value from platform_invoice_counters where year = split_part(n1, '-', 3)::int) <> seq1 then
    raise exception 'FAIL: counter moved for a sent invoice';
  end if;
  raise notice 'ok: sent invoice number stays retired';

  -- =========================================================
  -- 5. Reissue chain: deleting the original detaches the replacement
  -- =========================================================
  perform pg_temp.as_user(staff);
  inv3 := create_platform_invoice(sa, '2026-10-01', '2026-10-31', false, null, null, null);
  inv4 := reissue_platform_invoice(inv3, 'test reissue');
  select invoice_number into n1 from platform_invoices where id = inv3;
  perform delete_platform_invoice_permanently(inv3, n1, 'remove original');
  perform pg_temp.as_owner();
  if (select replaces_invoice_id from platform_invoices where id = inv4) is not null then raise exception 'FAIL: replacement still points at deleted invoice'; end if;
  if not exists (select 1 from platform_invoices where id = inv4) then raise exception 'FAIL: replacement invoice was removed'; end if;
  raise notice 'ok: reissue chain detaches cleanly';

  raise notice 'platform invoice permanent delete checks: all passed';
end $$;

rollback;

do $$
begin
  if exists (select 1 from schools where slug = 'del-test-a') then
    raise exception 'LEAK DETECTED: permanent-delete test fixtures were not rolled back';
  end if;
end $$;
