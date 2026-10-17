-- Behavioural tests for 20261017180000_demo_request_to_sales_lead.sql.
-- Same safety model as outbound_contact_log.sql: synthetic fixtures (.invalid addresses, 0700 000 xxx
-- numbers), impersonation via request.jwt.claims, and everything inside ONE transaction that ends in
-- ROLLBACK, so nothing persists.
--   psql "$SUPABASE_DB_URL" -v ON_ERROR_STOP=1 -f supabase/tests/demo_request_to_lead.sql
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

do $$
declare
  staff uuid := gen_random_uuid();
  nobody uuid := gen_random_uuid();
  rep uuid := gen_random_uuid();
  rep2 uuid := gen_random_uuid();
  r1 uuid; r2 uuid; r3 uuid; r4 uuid; r5 uuid; r6 uuid; r7 uuid;
  res jsonb;
  res2 jsonb;
  lead1 uuid;
  v text;
  today date := (now() at time zone 'Africa/Nairobi')::date;
  lead_row sales_leads%rowtype;
begin
  -- ---------- fixtures ----------
  insert into auth.users (id, aud, role, email) values
    (staff, 'authenticated', 'authenticated', 'drl-staff@example.invalid'),
    (nobody, 'authenticated', 'authenticated', 'drl-nobody@example.invalid');
  insert into school_users (school_id, auth_user_id, role_id, full_name, email) values
    (null, staff, (select id from roles where name = 'super_admin'), 'DRL Staff', 'drl-staff@example.invalid'),
    (null, nobody, (select id from roles where name = 'principal'), 'DRL Nobody', 'drl-nobody@example.invalid');
  insert into platform_team_members (id, name, email) values
    (rep, 'DRL Rep', 'drl-rep@example.invalid'), (rep2, 'DRL Rep Two', 'drl-rep2@example.invalid');

  insert into marketing_demo_requests (id, name, school_name, role, email, phone, student_count, message, utm_source, utm_medium, utm_campaign, assigned_to) values
    (gen_random_uuid(), 'Jane Wanjiru', 'DRL Sunrise Academy', 'Principal', 'Jane@DRL-Sunrise.invalid', '0700 000 101', 320,
     E'Preferred contact: WhatsApp\nPreferred time: morning\n\nWe want to move off paper fees.', 'google', 'cpc', 'kenya-schools', rep)
    returning id into r1;
  insert into marketing_demo_requests (name, school_name, role, email, phone) values
    ('Jane Again', 'drl sunrise academy', 'Principal', 'jane.other@drl-sunrise.invalid', '0700000199') returning id into r2;          -- same school name
  insert into marketing_demo_requests (name, school_name, role, email, phone) values
    ('Peter Otieno', 'DRL Different Name', 'Teacher', 'JANE@drl-sunrise.invalid', '0700000200') returning id into r3;                  -- same email as r1
  insert into marketing_demo_requests (name, school_name, role, email, phone) values
    ('Mary Achieng', 'DRL Third Name', 'Administrator', 'mary@drl-third.invalid', '+254 700 000 101') returning id into r4;            -- same phone as r1
  insert into marketing_demo_requests (name, school_name, role, email, phone, student_count) values
    ('Huge Numbers', 'DRL Huge School', 'Other', 'huge@drl-huge.invalid', '0700000300', 999999999) returning id into r5;               -- out-of-range student count
  insert into marketing_demo_requests (name, school_name, role, email, phone) values
    ('Closed Lead Contact', 'DRL Closed School', 'Owner', 'closed@drl-closed.invalid', '0700000400') returning id into r6;
  insert into marketing_demo_requests (name, school_name, role, email, phone) values
    ('Unrelated', 'DRL Unrelated School', 'Owner', 'unrelated@drl-unrelated.invalid', '0700000500') returning id into r7;

  -- ---------- 1. access control ----------
  perform pg_temp.as_anon();
  assert pg_temp.err(format($q$select public.admin_convert_demo_request_to_lead(%L)$q$, r1)) like '%permission denied%', 'anon cannot convert';
  perform pg_temp.as_user(nobody);
  assert pg_temp.err(format($q$select public.admin_convert_demo_request_to_lead(%L)$q$, r1)) like '%Not authorized%', 'non-admin cannot convert';
  perform pg_temp.as_owner();
  assert (select sales_lead_id from marketing_demo_requests where id = r1) is null, 'nothing changed by refused calls';
  assert not exists (select 1 from sales_leads where school_name = 'DRL Sunrise Academy'), 'no lead created by refused calls';

  perform pg_temp.as_user(staff);
  v := pg_temp.err($q$select public.admin_convert_demo_request_to_lead(gen_random_uuid())$q$);
  assert v like '%Demo request not found%', 'unknown request rejected: ' || v;

  -- ---------- 2. a new lead is created with the right shape ----------
  res := public.admin_convert_demo_request_to_lead(r1);
  assert (res ->> 'created')::boolean = true and (res ->> 'already_linked')::boolean = false, 'first conversion creates a lead';
  lead1 := (res ->> 'lead_id')::uuid;
  select * into lead_row from sales_leads where id = lead1;
  assert lead_row.school_name = 'DRL Sunrise Academy', 'school name copied';
  assert lead_row.contact_name = 'Jane Wanjiru' and lead_row.contact_role = 'Principal', 'contact copied';
  assert lead_row.email = 'Jane@DRL-Sunrise.invalid' and lead_row.phone = '0700 000 101', 'contact details copied as given';
  assert lead_row.source = 'inbound_web', 'source is inbound_web';
  assert lead_row.stage = 'new', 'stage is new (never advanced automatically)';
  assert lead_row.student_count = 320, 'student count copied';
  assert lead_row.assigned_to = rep, 'inherits the request''s assignee';
  assert lead_row.next_follow_up_on = today, 'follow-up due today (EAT)';
  assert lead_row.notes like '%We want to move off paper fees.%', 'message carried into notes';
  assert lead_row.notes like '%Campaign: google / cpc / kenya-schools%', 'campaign attribution carried into notes';
  assert (select sales_lead_id from marketing_demo_requests where id = r1) = lead1, 'request linked to the lead';
  assert (select status from marketing_demo_requests where id = r1) = 'new', 'request status untouched';
  assert (select count(*) from sales_lead_activities where lead_id = lead1 and activity_type = 'note') = 1, 'one activity note written';

  -- ---------- 3. idempotent ----------
  res2 := public.admin_convert_demo_request_to_lead(r1, rep2);
  assert (res2 ->> 'lead_id')::uuid = lead1 and (res2 ->> 'created')::boolean = false and (res2 ->> 'already_linked')::boolean = true, 'second call returns the same lead';
  assert (select count(*) from sales_leads where school_name = 'DRL Sunrise Academy') = 1, 'still exactly one lead';
  assert (select count(*) from sales_lead_activities where lead_id = lead1) = 1, 'no extra activity on a repeat';
  assert (select assigned_to from sales_leads where id = lead1) = rep, 'a repeat does not reassign';

  -- ---------- 4. duplicates are linked, not created ----------
  -- (a) same school name, different case/spacing
  res := public.admin_convert_demo_request_to_lead(r2);
  assert (res ->> 'lead_id')::uuid = lead1 and (res ->> 'created')::boolean = false, 'same name links to the existing lead';
  -- (b) same email, different case, different school name
  res := public.admin_convert_demo_request_to_lead(r3);
  assert (res ->> 'lead_id')::uuid = lead1 and (res ->> 'created')::boolean = false, 'same email links to the existing lead';
  -- (c) same phone written another way
  res := public.admin_convert_demo_request_to_lead(r4);
  assert (res ->> 'lead_id')::uuid = lead1 and (res ->> 'created')::boolean = false, 'same phone links to the existing lead';
  assert (select count(*) from sales_leads where lower(school_name) like 'drl %' and school_name <> 'DRL Closed School') = 1, 'still a single lead for all four requests';
  assert (select count(*) from marketing_demo_requests where sales_lead_id = lead1) = 4, 'all four requests point at that lead';
  assert (select count(*) from sales_lead_activities where lead_id = lead1 and summary like 'Another website demo request%') = 3, 'each repeat is noted on the lead';
  assert (select stage from sales_leads where id = lead1) = 'new', 'linking never changes the stage';

  -- a repeat enquiry pulls a later follow-up date forward to today, but never pushes one back
  perform pg_temp.as_owner();
  update sales_leads set next_follow_up_on = today + 10 where id = lead1;
  perform pg_temp.as_user(staff);
  perform public.admin_convert_demo_request_to_lead(
    (select id from marketing_demo_requests where id = r2 limit 1)); -- already linked: must NOT touch the date
  perform pg_temp.as_owner();
  assert (select next_follow_up_on from sales_leads where id = lead1) = today + 10, 'an already-linked repeat does not touch the date';
  insert into marketing_demo_requests (id, name, school_name, role, email, phone) values
    (gen_random_uuid(), 'Fresh Interest', 'DRL Sunrise Academy', 'Principal', 'x@drl-sunrise.invalid', '0700000601') returning id into r2;
  perform pg_temp.as_user(staff);
  perform public.admin_convert_demo_request_to_lead(r2);
  assert (select next_follow_up_on from sales_leads where id = lead1) = today, 'new interest on an open lead brings the follow-up to today';
  perform pg_temp.as_owner();
  update sales_leads set next_follow_up_on = today - 3 where id = lead1;
  insert into marketing_demo_requests (name, school_name, role, email, phone) values
    ('Later Interest', 'DRL Sunrise Academy', 'Principal', 'y@drl-sunrise.invalid', '0700000602') returning id into r2;
  perform pg_temp.as_user(staff);
  perform public.admin_convert_demo_request_to_lead(r2);
  assert (select next_follow_up_on from sales_leads where id = lead1) = today - 3, 'an overdue follow-up is never pushed back';

  -- ---------- 5. closed leads are noted but not reopened or rescheduled ----------
  perform pg_temp.as_owner();
  insert into sales_leads (school_name, email, stage, lost_reason) values
    ('DRL Closed School', 'closed@drl-closed.invalid', 'lost', 'went with a competitor');
  perform pg_temp.as_user(staff);
  res := public.admin_convert_demo_request_to_lead(r6);
  assert (res ->> 'created')::boolean = false, 'matches the closed lead';
  perform pg_temp.as_owner();
  select * into lead_row from sales_leads where school_name = 'DRL Closed School';
  assert lead_row.stage = 'lost' and lead_row.lost_reason is not null, 'closed lead stays lost';
  assert lead_row.next_follow_up_on is null, 'closed lead gets no follow-up date';
  perform pg_temp.as_user(staff);

  -- ---------- 6. bad data cannot break the conversion ----------
  res := public.admin_convert_demo_request_to_lead(r5);
  assert (res ->> 'created')::boolean = true, 'out-of-range student count still converts';
  perform pg_temp.as_owner();
  assert (select student_count from sales_leads where id = (res ->> 'lead_id')::uuid) is null, 'out-of-range student count dropped, not copied';
  perform pg_temp.as_user(staff);

  -- an explicit assignee is used when the request has none
  res := public.admin_convert_demo_request_to_lead(r7, rep2);
  perform pg_temp.as_owner();
  assert (select assigned_to from sales_leads where id = (res ->> 'lead_id')::uuid) = rep2, 'explicit assignee used';
  assert (select next_follow_up_on from sales_leads where id = (res ->> 'lead_id')::uuid) = today, 'new lead follow-up is today';

  -- a deleted lead un-links, and converting again creates a fresh one
  delete from sales_leads where id = (res ->> 'lead_id')::uuid;
  assert (select sales_lead_id from marketing_demo_requests where id = r7) is null, 'deleting the lead clears the link';
  perform pg_temp.as_user(staff);
  res2 := public.admin_convert_demo_request_to_lead(r7);
  assert (res2 ->> 'created')::boolean = true, 'can convert again after the lead was removed';

  raise notice 'demo request to lead behavioural checks all passed';
end $$;

rollback;

do $$
begin
  if exists (select 1 from marketing_demo_requests where school_name like 'DRL %' or school_name like 'drl %') then
    raise exception 'LEAK DETECTED: demo-request test fixtures were not rolled back';
  end if;
end $$;
