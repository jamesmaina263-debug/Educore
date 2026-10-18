-- Behavioural tests for 20261017200000_growth_report.sql (admin_growth_report).
-- Same safety model as the other supabase/tests files: synthetic fixtures (.invalid addresses, "grt-" names),
-- impersonation via request.jwt.claims, ONE transaction ending in ROLLBACK.
-- The report aggregates the whole database, so every assertion is a DELTA between a call made before the
-- fixtures exist and a call made after: existing data cannot skew it. Run it against a safe target:
--   psql "$SUPABASE_DB_URL" -v ON_ERROR_STOP=1 -f supabase/tests/growth_report.sql
-- Prints "NOTICE: ... all passed" on success and raises on the first failure.

begin;

create or replace function pg_temp.as_user(p_uid uuid) returns void language plpgsql as $$
begin
  execute 'reset role';
  execute 'set local role authenticated';
  perform set_config('request.jwt.claims', json_build_object('sub', p_uid, 'role', 'authenticated')::text, true);
end $$;

create or replace function pg_temp.as_anon() returns void language plpgsql as $$
begin
  execute 'reset role';
  execute 'set local role anon';
  perform set_config('request.jwt.claims', json_build_object('role', 'anon')::text, true);
end $$;

create or replace function pg_temp.as_owner() returns void language plpgsql as $$
begin
  execute 'reset role';
  perform set_config('request.jwt.claims', '', true);
end $$;

create or replace function pg_temp.err(p_sql text) returns text language plpgsql as $$
begin
  execute p_sql;
  return '';
exception when others then
  return sqlerrm;
end $$;

-- numeric value at a path, 0 when the key is absent
create or replace function pg_temp.n(j jsonb, path text[]) returns numeric language sql immutable as $$
  select coalesce((j #>> path)::numeric, 0) $$;

-- the element of a jsonb array whose key equals value ('{}' when none)
create or replace function pg_temp.pick(arr jsonb, key text, val text) returns jsonb language sql immutable as $$
  select coalesce((select e from jsonb_array_elements(coalesce(arr, '[]'::jsonb)) e where e ->> key = val limit 1), '{}'::jsonb) $$;

do $$
declare
  staff uuid := gen_random_uuid();
  nobody uuid := gen_random_uuid();
  today date := (now() at time zone 'Africa/Nairobi')::date;
  b jsonb; a jsonb; yb jsonb; ya jsonb;
  l_new uuid; l_demo uuid; l_paid uuid; l_booked uuid; l_lost uuid; l_old uuid;
  s uuid; i int;
  e jsonb;
begin
  -- ---------- fixtures: users ----------
  insert into auth.users (id, aud, role, email) values
    (staff, 'authenticated', 'authenticated', 'grt-staff@example.invalid'),
    (nobody, 'authenticated', 'authenticated', 'grt-nobody@example.invalid');
  insert into school_users (school_id, auth_user_id, role_id, full_name, email) values
    (null, staff, (select id from roles where name = 'super_admin'), 'GRT Staff', 'grt-staff@example.invalid'),
    (null, nobody, (select id from roles where name = 'principal'), 'GRT Nobody', 'grt-nobody@example.invalid');

  -- ---------- 1. access control and input checks ----------
  perform pg_temp.as_anon();
  assert pg_temp.err(format($q$select public.admin_growth_report(%L, %L)$q$, today, today)) like '%permission denied%', 'anon cannot call it';
  perform pg_temp.as_user(nobody);
  assert pg_temp.err(format($q$select public.admin_growth_report(%L, %L)$q$, today, today)) like '%Not authorized%', 'non-admin refused';
  perform pg_temp.as_user(staff);
  assert pg_temp.err(format($q$select public.admin_growth_report(%L, %L)$q$, today, today - 1)) like '%valid date range%', 'from after to refused';
  assert pg_temp.err($q$select public.admin_growth_report(null, current_date)$q$) like '%valid date range%', 'null refused';
  assert pg_temp.err(format($q$select public.admin_growth_report(%L, %L)$q$, today - 401, today)) like '%too long%', 'over 400 days refused';
  assert pg_temp.err(format($q$select public.admin_growth_report(%L, %L)$q$, today - 400, today)) = '', 'exactly 400 days allowed';
  assert (select provolatile from pg_proc where proname = 'admin_growth_report') = 's', 'function is STABLE (read-only)';

  -- ---------- 2. BEFORE snapshot ----------
  b := public.admin_growth_report(today, today);
  yb := public.admin_growth_report(today - 1, today - 1);

  -- ---------- 3. fixtures: leads ----------
  perform pg_temp.as_owner();
  insert into sales_leads (school_name, source, stage, next_follow_up_on) values ('GRT Lead New', 'inbound_web', 'new', today - 2) returning id into l_new;
  insert into sales_leads (school_name, source, stage, next_follow_up_on) values ('GRT Lead Demo Done', 'inbound_web', 'demo_done', today) returning id into l_demo;
  insert into sales_leads (school_name, source, stage) values ('GRT Lead Paid', 'outbound', 'paid') returning id into l_paid;
  insert into sales_leads (school_name, source, stage) values ('GRT Lead Booked', 'door_visit', 'demo_booked') returning id into l_booked;
  insert into sales_leads (school_name, source, stage, lost_reason) values ('GRT Lead Lost', null, 'lost', 'Went with Competitor X  ') returning id into l_lost;
  insert into sales_leads (school_name, source, stage, created_at, stage_changed_at) values ('GRT Lead Old', 'referral', 'new', now() - interval '10 days', now() - interval '10 days') returning id into l_old;

  -- ---------- fixtures: demo requests (12 in one campaign so it makes the top 10) ----------
  for i in 1..12 loop
    insert into marketing_demo_requests (name, school_name, role, email, utm_campaign, sales_lead_id)
    values ('GRT Person', 'GRT School ' || i, 'Principal', 'grt' || i || '@example.invalid', 'grt-report-campaign',
            case i when 1 then l_demo when 2 then l_paid when 3 then l_new else null end);
  end loop;
  insert into marketing_demo_requests (name, school_name, role, email) values ('GRT No Campaign', 'GRT School None', 'Owner', 'grt-none@example.invalid');
  -- 10 days ago: outside a today-only range
  insert into marketing_demo_requests (name, school_name, role, email, utm_campaign, created_at)
    values ('GRT Old', 'GRT School Old', 'Owner', 'grt-old@example.invalid', 'grt-report-campaign', now() - interval '10 days');
  -- 23:30 East Africa Time yesterday: belongs to YESTERDAY in Kenya time, not today
  insert into marketing_demo_requests (name, school_name, role, email, created_at)
    values ('GRT Boundary Late', 'GRT School Boundary Late', 'Owner', 'grt-boundary-late@example.invalid',
            ((today - 1)::timestamp + time '23:30') at time zone 'Africa/Nairobi');
  -- 01:00 East Africa Time today: still YESTERDAY in UTC, but TODAY in Kenya time. This is the row that
  -- tells the two time zones apart (23:30 EAT is the same calendar day in UTC, so it cannot).
  insert into marketing_demo_requests (name, school_name, role, email, created_at)
    values ('GRT Boundary Early', 'GRT School Boundary Early', 'Owner', 'grt-boundary-early@example.invalid',
            (today::timestamp + time '01:00') at time zone 'Africa/Nairobi');

  -- ---------- fixtures: trials (11 in one campaign so it makes the top 10) ----------
  for i in 1..11 loop
    insert into schools (name, slug) values ('GRT Trial School ' || i, 'grt-trial-' || i) returning id into s;
    insert into school_subscriptions (school_id, status) values (s, case i when 1 then 'active' else 'trialing' end);
    insert into marketing_signup_attribution (school_id, utm_campaign) values (s, 'grt-trial-campaign');
    if i = 1 then insert into platform_invoices (school_id, status) values (s, 'paid'); end if;
    if i = 2 then insert into platform_invoices (school_id, status) values (s, 'issued'); end if;  -- issued is not paid
  end loop;
  insert into schools (name, slug) values ('GRT Trial Unattributed', 'grt-trial-unattr') returning id into s;
  insert into school_subscriptions (school_id, status) values (s, 'past_due');
  insert into schools (name, slug) values ('GRT Trial Old', 'grt-trial-old') returning id into s;
  insert into school_subscriptions (school_id, status, created_at) values (s, 'active', now() - interval '10 days');

  -- ---------- fixtures: AI usage log ----------
  insert into platform_admin_activity_log (actor_user_id, action, detail) values
    (staff, 'score_outbound_prospects', jsonb_build_object('total_tokens', 1000)),
    (staff, 'score_outbound_prospects', jsonb_build_object('total_tokens', 'abc')),   -- junk: counted as a call, 0 tokens
    (staff, 'enrich_outbound_prospects', jsonb_build_object('total_tokens', 500)),
    (staff, 'review_outbound_prospect', jsonb_build_object('total_tokens', 99999));   -- not an AI action: ignored
  insert into platform_admin_activity_log (actor_user_id, action, detail, created_at)
    values (staff, 'score_outbound_prospects', jsonb_build_object('total_tokens', 7777), now() - interval '10 days');

  -- ---------- 4. AFTER snapshot ----------
  perform pg_temp.as_user(staff);
  a := public.admin_growth_report(today, today);
  ya := public.admin_growth_report(today - 1, today - 1);

  assert a ->> 'from' = today::text and a ->> 'to' = today::text, 'range echoed';

  -- demo requests: 12 + 1 + the 01:00-today row; the 10-day-old and the 23:30-yesterday rows are excluded
  assert pg_temp.n(a, '{demo_requests,total}') - pg_temp.n(b, '{demo_requests,total}') = 14, 'demo requests today: +14';
  assert pg_temp.n(a, '{demo_requests,in_pipeline}') - pg_temp.n(b, '{demo_requests,in_pipeline}') = 3, 'in pipeline: +3';
  e := pg_temp.pick(a -> 'demo_requests' -> 'by_campaign', 'campaign', 'grt-report-campaign');
  assert (e ->> 'requests')::int = 12, 'campaign requests = 12 (old row excluded), got ' || coalesce(e ->> 'requests', 'missing');
  assert (e ->> 'in_pipeline')::int = 3, 'campaign in pipeline = 3';
  assert (e ->> 'reached_demo')::int = 2, 'campaign reached demo (demo_done + paid) = 2';
  assert (e ->> 'paid')::int = 1, 'campaign paid = 1';
  assert jsonb_typeof(a -> 'demo_requests' -> 'by_campaign') = 'array', 'by_campaign is an array';

  -- Kenya-time day boundary
  assert pg_temp.n(ya, '{demo_requests,total}') - pg_temp.n(yb, '{demo_requests,total}') = 1, 'yesterday gets only the 23:30 EAT row (not the 01:00 EAT one)';
  assert pg_temp.n(a, '{demo_requests,total}') - pg_temp.n(b, '{demo_requests,total}') = 14, '... and today gets the 01:00 EAT row but not the 23:30 one';

  -- leads created today, by source
  assert pg_temp.n(a, '{leads_created,total}') - pg_temp.n(b, '{leads_created,total}') = 5, 'leads created today: +5 (old one excluded)';
  assert jsonb_typeof(a -> 'leads_created' -> 'by_source') = 'array', 'by_source is an array';
  assert coalesce((pg_temp.pick(a -> 'leads_created' -> 'by_source', 'source', 'inbound_web') ->> 'n')::int, 0)
       - coalesce((pg_temp.pick(b -> 'leads_created' -> 'by_source', 'source', 'inbound_web') ->> 'n')::int, 0) = 2, 'inbound_web +2';
  assert coalesce((pg_temp.pick(a -> 'leads_created' -> 'by_source', 'source', 'outbound') ->> 'n')::int, 0)
       - coalesce((pg_temp.pick(b -> 'leads_created' -> 'by_source', 'source', 'outbound') ->> 'n')::int, 0) = 1, 'outbound +1';
  assert coalesce((pg_temp.pick(a -> 'leads_created' -> 'by_source', 'source', 'unspecified') ->> 'n')::int, 0)
       - coalesce((pg_temp.pick(b -> 'leads_created' -> 'by_source', 'source', 'unspecified') ->> 'n')::int, 0) = 1, 'null source shows as unspecified';

  -- pipeline today (snapshot): open excludes paid and lost
  assert pg_temp.n(a, '{pipeline_now,open}') - pg_temp.n(b, '{pipeline_now,open}') = 4, 'open +4 (new, demo_done, booked, old)';
  assert pg_temp.n(a, '{pipeline_now,overdue_followups}') - pg_temp.n(b, '{pipeline_now,overdue_followups}') = 1, 'overdue +1';
  assert pg_temp.n(a, '{pipeline_now,due_today}') - pg_temp.n(b, '{pipeline_now,due_today}') = 1, 'due today +1';
  assert pg_temp.n(a, '{pipeline_now,no_followup}') - pg_temp.n(b, '{pipeline_now,no_followup}') = 2, 'open with no follow-up +2 (closed ones excluded)';
  assert pg_temp.n(a, '{pipeline_now,by_stage,new}') - pg_temp.n(b, '{pipeline_now,by_stage,new}') = 2, 'by_stage new +2';
  assert pg_temp.n(a, '{pipeline_now,by_stage,paid}') - pg_temp.n(b, '{pipeline_now,by_stage,paid}') = 1, 'by_stage paid +1';
  assert pg_temp.n(a, '{pipeline_now,by_stage,lost}') - pg_temp.n(b, '{pipeline_now,by_stage,lost}') = 1, 'by_stage lost +1';

  -- cohort: leads created in the range, where they are now
  assert pg_temp.n(a, '{lead_cohort,created}') - pg_temp.n(b, '{lead_cohort,created}') = 5, 'cohort created +5';
  assert pg_temp.n(a, '{lead_cohort,at_or_past_demo_booked}') - pg_temp.n(b, '{lead_cohort,at_or_past_demo_booked}') = 3, 'at/past demo_booked +3';
  assert pg_temp.n(a, '{lead_cohort,at_or_past_demo_done}') - pg_temp.n(b, '{lead_cohort,at_or_past_demo_done}') = 2, 'at/past demo_done +2';
  assert pg_temp.n(a, '{lead_cohort,pilot_or_paid}') - pg_temp.n(b, '{lead_cohort,pilot_or_paid}') = 1, 'pilot or paid +1';
  assert pg_temp.n(a, '{lead_cohort,paid}') - pg_temp.n(b, '{lead_cohort,paid}') = 1, 'paid +1';
  assert pg_temp.n(a, '{lead_cohort,lost}') - pg_temp.n(b, '{lead_cohort,lost}') = 1, 'lost +1';

  -- lost reasons (lower-cased, trimmed)
  assert pg_temp.n(a, '{lost,in_period}') - pg_temp.n(b, '{lost,in_period}') = 1, 'lost in period +1';
  assert coalesce((pg_temp.pick(a -> 'lost' -> 'reasons', 'reason', 'went with competitor x') ->> 'n')::int, 0)
       - coalesce((pg_temp.pick(b -> 'lost' -> 'reasons', 'reason', 'went with competitor x') ->> 'n')::int, 0) = 1, 'lost reason normalised and counted';

  -- trials started today and where they are now; only a PAID invoice counts as paid
  assert pg_temp.n(a, '{trials,started}') - pg_temp.n(b, '{trials,started}') = 12, 'trials started +12 (old one excluded)';
  assert pg_temp.n(a, '{trials,by_status,trialing}') - pg_temp.n(b, '{trials,by_status,trialing}') = 10, 'trialing +10';
  assert pg_temp.n(a, '{trials,by_status,active}') - pg_temp.n(b, '{trials,by_status,active}') = 1, 'active +1';
  assert pg_temp.n(a, '{trials,by_status,past_due}') - pg_temp.n(b, '{trials,by_status,past_due}') = 1, 'past_due +1';
  assert pg_temp.n(a, '{trials,paid_invoice}') - pg_temp.n(b, '{trials,paid_invoice}') = 1, 'paid invoice +1 (an issued invoice is not paid)';
  e := pg_temp.pick(a -> 'trials' -> 'by_campaign', 'campaign', 'grt-trial-campaign');
  assert (e ->> 'trials')::int = 11 and (e ->> 'paid_invoice')::int = 1, 'trial campaign: 11 trials, 1 paid';

  -- AI usage: only the two outreach AI actions, junk token values count as 0, old rows excluded
  e := pg_temp.pick(a -> 'ai_usage', 'action', 'score_outbound_prospects');
  assert coalesce((e ->> 'calls')::int, 0) - coalesce((pg_temp.pick(b -> 'ai_usage', 'action', 'score_outbound_prospects') ->> 'calls')::int, 0) = 2, 'score calls +2';
  assert coalesce((e ->> 'total_tokens')::bigint, 0) - coalesce((pg_temp.pick(b -> 'ai_usage', 'action', 'score_outbound_prospects') ->> 'total_tokens')::bigint, 0) = 1000, 'score tokens +1000 (junk = 0, old excluded)';
  e := pg_temp.pick(a -> 'ai_usage', 'action', 'enrich_outbound_prospects');
  assert coalesce((e ->> 'total_tokens')::bigint, 0) - coalesce((pg_temp.pick(b -> 'ai_usage', 'action', 'enrich_outbound_prospects') ->> 'total_tokens')::bigint, 0) = 500, 'enrich tokens +500';
  assert pg_temp.pick(a -> 'ai_usage', 'action', 'review_outbound_prospect') = '{}'::jsonb, 'non-AI actions are not reported';

  raise notice 'growth report behavioural checks all passed';
end $$;

rollback;

do $$
begin
  if exists (select 1 from sales_leads where school_name like 'GRT %')
     or exists (select 1 from marketing_demo_requests where school_name like 'GRT %') then
    raise exception 'LEAK DETECTED: growth-report test fixtures were not rolled back';
  end if;
end $$;
