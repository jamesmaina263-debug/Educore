-- Behavioural test for WP 1.3b (migration *_wp_1_3b_stk_internal_dispatch_allowed). Rollback-only, synthetic fixtures.
-- Checks: only STK requests raised through a pay link are allowed for the internal dispatch mode; a staff-raised request
-- and an unknown id are not; the function is service_role only.
--   psql "$SUPABASE_DB_URL" -v ON_ERROR_STOP=1 -f supabase/tests/mpesa_stk_internal_dispatch.sql
begin;

do $$
declare
  sa uuid := gen_random_uuid(); s_id uuid := gen_random_uuid(); lk uuid := gen_random_uuid();
  r_link uuid := gen_random_uuid(); r_staff uuid := gen_random_uuid();
begin
  insert into schools (id, name, slug, application_number_prefix) values (sa, 'Dispatch Test', 'dispatch-test-a', 'DPT');
  insert into students (id, school_id, first_name, last_name, date_of_birth, gender, status) values (s_id, sa, 'Amani', 'T', date '2012-01-01', 'male', 'approved');
  insert into mpesa_stk_requests (id, school_id, student_id, amount, phone_number, status) values
    (r_link, sa, s_id, 1000, '254700000111', 'pending'), (r_staff, sa, s_id, 1000, '254700000111', 'pending');
  insert into pay_links (id, school_id, student_id, amount, token_hash, expires_at)
    values (lk, sa, s_id, 1000, repeat('a', 64), now() + interval '1 day');
  insert into pay_link_attempts (link_id, school_id, stk_request_id) values (lk, sa, r_link);

  assert mpesa_stk_internal_dispatch_allowed(r_link) = true, '1: a pay-link request is allowed';
  assert mpesa_stk_internal_dispatch_allowed(r_staff) = false, '2: a staff-raised request is NOT allowed';
  assert mpesa_stk_internal_dispatch_allowed(gen_random_uuid()) = false, '3: an unknown id is NOT allowed';
  assert mpesa_stk_internal_dispatch_allowed(null) = false, '4: null is NOT allowed';

  assert not has_function_privilege('anon', 'public.mpesa_stk_internal_dispatch_allowed(uuid)', 'execute'), '5: anon';
  assert not has_function_privilege('authenticated', 'public.mpesa_stk_internal_dispatch_allowed(uuid)', 'execute'), '5: authenticated';
  assert has_function_privilege('service_role', 'public.mpesa_stk_internal_dispatch_allowed(uuid)', 'execute'), '5: service_role';
end
$$;

rollback;

do $$
begin
  if exists (select 1 from schools where slug = 'dispatch-test-a') then
    raise exception 'LEAK DETECTED: dispatch test fixtures were not rolled back -- fix this test file before trusting it again';
  end if;
end
$$;
