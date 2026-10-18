-- Behavioural tests for 20261018190000_sales_lead_demos.sql.
-- Same safety model as outbound_contact_log.sql: synthetic fixtures (.invalid addresses), impersonation via
-- request.jwt.claims, everything inside ONE transaction that ends in ROLLBACK, so nothing persists.
--   psql "$SUPABASE_DB_URL" -v ON_ERROR_STOP=1 -f supabase/tests/sales_lead_demos.sql
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
  staff uuid := gen_random_uuid();
  nobody uuid := gen_random_uuid();
  rep uuid := gen_random_uuid();
  lead_new uuid; lead_pilot uuid; lead_done uuid; lead_paid uuid; lead_lost uuid; lead_later uuid; lead_early uuid;
  d1 uuid; d2 uuid; d3 uuid; d4 uuid;
  n integer;
  v text;
  s text;
  f date;
  future1 timestamptz := now() + interval '3 days';
  future2 timestamptz := now() + interval '5 days';
begin
  -- ---------- fixtures ----------
  insert into auth.users (id, aud, role, email) values
    (staff, 'authenticated', 'authenticated', 'dm-staff@example.invalid'),
    (nobody, 'authenticated', 'authenticated', 'dm-nobody@example.invalid');
  insert into school_users (school_id, auth_user_id, role_id, full_name, email) values
    (null, staff, (select id from roles where name = 'super_admin'), 'DM Staff', 'dm-staff@example.invalid'),
    (null, nobody, (select id from roles where name = 'principal'), 'DM Nobody', 'dm-nobody@example.invalid');
  insert into platform_team_members (id, name, email) values (rep, 'DM Rep', 'dm-rep@example.invalid');

  insert into sales_leads (school_name, stage) values ('DM New School', 'new') returning id into lead_new;
  insert into sales_leads (school_name, stage) values ('DM Pilot School', 'pilot') returning id into lead_pilot;
  insert into sales_leads (school_name, stage) values ('DM Done School', 'demo_done') returning id into lead_done;
  insert into sales_leads (school_name, stage) values ('DM Paid School', 'paid') returning id into lead_paid;
  insert into sales_leads (school_name, stage, lost_reason) values ('DM Lost School', 'lost', 'test') returning id into lead_lost;
  insert into sales_leads (school_name, stage, next_follow_up_on) values ('DM Later Follow-up', 'visited', current_date + 30) returning id into lead_later;
  insert into sales_leads (school_name, stage, next_follow_up_on) values ('DM Early Follow-up', 'visited', current_date + 1) returning id into lead_early;

  perform pg_temp.as_user(staff);

  -- ---------- 1. booking a demo for a new lead ----------
  d1 := admin_book_sales_lead_demo(lead_new, future1, 'in_person', '  Head office  ', rep, rep);
  perform pg_temp.as_owner();
  select count(*) into n from sales_lead_demos
   where id = d1 and lead_id = lead_new and mode = 'in_person' and location_note = 'Head office'
     and host_id = rep and status = 'scheduled' and scheduled_for = future1;
  if n <> 1 then raise exception 'FAIL 1a: demo row not stored as expected'; end if;
  select stage into s from sales_leads where id = lead_new;
  if s <> 'demo_booked' then raise exception 'FAIL 1b: stage is % (want demo_booked)', s; end if;
  select count(*) into n from sales_lead_activities where lead_id = lead_new and activity_type = 'stage_change' and summary like '%new -> demo_booked%';
  if n <> 1 then raise exception 'FAIL 1c: stage change not logged once (%)', n; end if;
  select count(*) into n from sales_lead_activities where lead_id = lead_new and activity_type = 'demo' and summary like 'Demo booked for % EAT (in person)';
  if n <> 1 then raise exception 'FAIL 1d: booking activity not logged once (%)', n; end if;
  select next_follow_up_on into f from sales_leads where id = lead_new;
  if f is distinct from (future1 at time zone 'Africa/Nairobi')::date then raise exception 'FAIL 1e: follow-up is %', f; end if;

  -- ---------- 2. validation ----------
  perform pg_temp.as_user(staff);
  v := pg_temp.err(format('select admin_book_sales_lead_demo(%L, %L, ''phone'')', lead_new, future2));
  if v not like 'This lead already has a scheduled demo%' then raise exception 'FAIL 2a: got %', v; end if;
  v := pg_temp.err(format('select admin_book_sales_lead_demo(%L, %L, ''phone'')', lead_later, now() - interval '1 hour'));
  if v <> 'Pick a date and time in the future.' then raise exception 'FAIL 2b: got %', v; end if;
  v := pg_temp.err(format('select admin_book_sales_lead_demo(%L, %L, ''smoke_signal'')', lead_later, future1));
  if v <> 'Mode must be in_person, video_call or phone.' then raise exception 'FAIL 2c: got %', v; end if;
  v := pg_temp.err(format('select admin_book_sales_lead_demo(%L, %L, ''phone'')', gen_random_uuid(), future1));
  if v <> 'Sales lead not found.' then raise exception 'FAIL 2d: got %', v; end if;
  v := pg_temp.err(format('select admin_book_sales_lead_demo(%L, %L, ''phone'')', lead_paid, future1));
  if v <> 'A demo cannot be booked for a paid or lost lead.' then raise exception 'FAIL 2e: got %', v; end if;
  v := pg_temp.err(format('select admin_book_sales_lead_demo(%L, %L, ''phone'')', lead_lost, future1));
  if v <> 'A demo cannot be booked for a paid or lost lead.' then raise exception 'FAIL 2f: got %', v; end if;
  v := pg_temp.err(format('select admin_book_sales_lead_demo(%L, %L, ''phone'', null, %L)', lead_later, future1, gen_random_uuid()));
  if v <> 'Team member not found.' then raise exception 'FAIL 2g: got %', v; end if;
  v := pg_temp.err(format('select admin_book_sales_lead_demo(%L, %L, ''phone'', %L)', lead_later, future1, repeat('x', 301)));
  if v not like 'Location / link is too long%' then raise exception 'FAIL 2h: got %', v; end if;
  perform pg_temp.as_owner();
  select count(*) into n from sales_lead_demos where lead_id in (lead_paid, lead_lost, lead_later);
  if n <> 0 then raise exception 'FAIL 2i: refused bookings left rows (%)', n; end if;
  select count(*) into n from sales_lead_demos where lead_id = lead_new;
  if n <> 1 then raise exception 'FAIL 2j: duplicate scheduled demo exists (%)', n; end if;
  -- the unique index holds even for a direct (owner) insert
  v := pg_temp.err(format('insert into sales_lead_demos (lead_id, scheduled_for, mode) values (%L, %L, ''phone'')', lead_new, future2));
  if v = '' then raise exception 'FAIL 2k: a second scheduled demo was inserted directly'; end if;

  -- ---------- 3. stage never moves backwards; follow-up only comes forward ----------
  perform pg_temp.as_user(staff);
  perform admin_book_sales_lead_demo(lead_pilot, future1, 'video_call');
  perform admin_book_sales_lead_demo(lead_done, future1, 'phone');
  perform admin_book_sales_lead_demo(lead_later, future1, 'phone');
  perform admin_book_sales_lead_demo(lead_early, future1, 'phone');
  perform pg_temp.as_owner();
  select stage into s from sales_leads where id = lead_pilot;
  if s <> 'pilot' then raise exception 'FAIL 3a: pilot lead moved to %', s; end if;
  select stage into s from sales_leads where id = lead_done;
  if s <> 'demo_done' then raise exception 'FAIL 3b: demo_done lead moved to %', s; end if;
  select count(*) into n from sales_lead_activities where lead_id in (lead_pilot, lead_done) and activity_type = 'stage_change';
  if n <> 0 then raise exception 'FAIL 3c: stage_change logged for a lead that did not move (%)', n; end if;
  select next_follow_up_on into f from sales_leads where id = lead_later;
  if f is distinct from (future1 at time zone 'Africa/Nairobi')::date then raise exception 'FAIL 3d: later follow-up not brought forward (%)', f; end if;
  select next_follow_up_on into f from sales_leads where id = lead_early;
  if f is distinct from current_date + 1 then raise exception 'FAIL 3e: earlier follow-up was pushed back (%)', f; end if;

  -- ---------- 4. reschedule ----------
  perform pg_temp.as_user(staff);
  v := pg_temp.err(format('select admin_reschedule_sales_lead_demo(%L, %L)', d1, now() - interval '1 day'));
  if v <> 'Pick a date and time in the future.' then raise exception 'FAIL 4a: got %', v; end if;
  v := pg_temp.err(format('select admin_reschedule_sales_lead_demo(%L, %L)', gen_random_uuid(), future2));
  if v <> 'Demo not found.' then raise exception 'FAIL 4b: got %', v; end if;
  perform admin_reschedule_sales_lead_demo(d1, future2, rep);
  perform pg_temp.as_owner();
  select count(*) into n from sales_lead_demos where id = d1 and scheduled_for = future2 and status = 'scheduled';
  if n <> 1 then raise exception 'FAIL 4c: demo not rescheduled'; end if;
  select count(*) into n from sales_lead_activities where lead_id = lead_new and summary like 'Demo rescheduled from % to % EAT';
  if n <> 1 then raise exception 'FAIL 4d: reschedule not logged once (%)', n; end if;
  -- same time again: no-op, no extra activity
  perform pg_temp.as_user(staff);
  perform admin_reschedule_sales_lead_demo(d1, future2, rep);
  perform pg_temp.as_owner();
  select count(*) into n from sales_lead_activities where lead_id = lead_new and summary like 'Demo rescheduled%';
  if n <> 1 then raise exception 'FAIL 4e: no-op reschedule logged again (%)', n; end if;

  -- ---------- 5. closing out ----------
  perform pg_temp.as_user(staff);
  v := pg_temp.err(format('select admin_set_sales_lead_demo_status(%L, ''held'')', d1));
  if v <> 'This demo has not happened yet.' then raise exception 'FAIL 5a: held in the future got %', v; end if;
  v := pg_temp.err(format('select admin_set_sales_lead_demo_status(%L, ''no_show'')', d1));
  if v <> 'This demo has not happened yet.' then raise exception 'FAIL 5b: no_show in the future got %', v; end if;
  v := pg_temp.err(format('select admin_set_sales_lead_demo_status(%L, ''scheduled'')', d1));
  if v <> 'Status must be held, no_show or cancelled.' then raise exception 'FAIL 5c: got %', v; end if;
  v := pg_temp.err(format('select admin_set_sales_lead_demo_status(%L, ''held'', %L)', d1, repeat('x', 501)));
  if v not like 'Note is too long%' then raise exception 'FAIL 5d: got %', v; end if;

  -- time passes (owner backdates the demo)
  perform pg_temp.as_owner();
  update sales_lead_demos set scheduled_for = now() - interval '2 hours' where id = d1;
  perform pg_temp.as_user(staff);
  perform admin_set_sales_lead_demo_status(d1, 'held', '  went well  ', rep);
  perform pg_temp.as_owner();
  select count(*) into n from sales_lead_demos where id = d1 and status = 'held' and outcome_note = 'went well';
  if n <> 1 then raise exception 'FAIL 5e: demo not marked held with note'; end if;
  select stage into s from sales_leads where id = lead_new;
  if s <> 'demo_done' then raise exception 'FAIL 5f: held demo left stage at %', s; end if;
  select count(*) into n from sales_lead_activities where lead_id = lead_new and activity_type = 'demo' and summary like 'Demo of % EAT: held (went well)';
  if n <> 1 then raise exception 'FAIL 5g: held not logged once (%)', n; end if;

  -- repeating the same action: no-op; a different one: refused
  perform pg_temp.as_user(staff);
  perform admin_set_sales_lead_demo_status(d1, 'held', null, rep);
  v := pg_temp.err(format('select admin_set_sales_lead_demo_status(%L, ''cancelled'')', d1));
  if v <> 'This demo is already marked held.' then raise exception 'FAIL 5h: got %', v; end if;
  v := pg_temp.err(format('select admin_reschedule_sales_lead_demo(%L, %L)', d1, future2));
  if v <> 'Only a scheduled demo can be rescheduled.' then raise exception 'FAIL 5h2: reschedule of a held demo got %', v; end if;
  perform pg_temp.as_owner();
  select count(*) into n from sales_lead_activities where lead_id = lead_new and summary like 'Demo of % EAT: %';
  if n <> 1 then raise exception 'FAIL 5i: repeat close logged again (%)', n; end if;

  -- held on a lead already at pilot keeps pilot (never backwards)
  select id into d2 from sales_lead_demos where lead_id = lead_pilot;
  update sales_lead_demos set scheduled_for = now() - interval '1 hour' where id = d2;
  perform pg_temp.as_user(staff);
  perform admin_set_sales_lead_demo_status(d2, 'held');
  perform pg_temp.as_owner();
  select stage into s from sales_leads where id = lead_pilot;
  if s <> 'pilot' then raise exception 'FAIL 5j: held moved a pilot lead to %', s; end if;

  -- no-show: stage unchanged, follow-up brought forward to today (EAT)
  select id into d3 from sales_lead_demos where lead_id = lead_later;
  update sales_lead_demos set scheduled_for = now() - interval '1 hour' where id = d3;
  perform pg_temp.as_user(staff);
  perform admin_set_sales_lead_demo_status(d3, 'no_show', 'did not pick up');
  perform pg_temp.as_owner();
  select stage into s from sales_leads where id = lead_later;
  if s <> 'demo_booked' then raise exception 'FAIL 5k: no_show changed stage to %', s; end if;
  select next_follow_up_on into f from sales_leads where id = lead_later;
  if f is distinct from (now() at time zone 'Africa/Nairobi')::date then raise exception 'FAIL 5l: no_show follow-up is %', f; end if;

  -- cancelled (allowed before the start time): stage unchanged, and a new demo can then be booked
  select id into d4 from sales_lead_demos where lead_id = lead_early;
  perform pg_temp.as_user(staff);
  perform admin_set_sales_lead_demo_status(d4, 'cancelled', 'school asked to cancel');
  perform pg_temp.as_owner();
  select stage into s from sales_leads where id = lead_early;
  if s <> 'demo_booked' then raise exception 'FAIL 5m: cancel changed stage to %', s; end if;
  perform pg_temp.as_user(staff);
  perform admin_book_sales_lead_demo(lead_early, future2, 'phone');
  perform pg_temp.as_owner();
  select count(*) into n from sales_lead_demos where lead_id = lead_early;
  if n <> 2 then raise exception 'FAIL 5n: rebooking after cancel gave % rows', n; end if;

  -- ---------- 6. access control ----------
  perform pg_temp.as_user(nobody);
  v := pg_temp.err(format('select admin_book_sales_lead_demo(%L, %L, ''phone'')', lead_new, future1));
  if v <> 'Not authorized to manage sales leads.' then raise exception 'FAIL 6a: got %', v; end if;
  v := pg_temp.err(format('select admin_reschedule_sales_lead_demo(%L, %L)', d3, future1));
  if v <> 'Not authorized to manage sales leads.' then raise exception 'FAIL 6b: got %', v; end if;
  v := pg_temp.err(format('select admin_set_sales_lead_demo_status(%L, ''cancelled'')', d3));
  if v <> 'Not authorized to manage sales leads.' then raise exception 'FAIL 6c: got %', v; end if;
  select count(*) into n from sales_lead_demos;
  if n <> 0 then raise exception 'FAIL 6d: non-admin can read demos (%)', n; end if;

  perform pg_temp.as_anon();
  v := pg_temp.err(format('select admin_book_sales_lead_demo(%L, %L, ''phone'')', lead_new, future1));
  if v = '' then raise exception 'FAIL 6e: anon could book a demo'; end if;

  perform pg_temp.as_user(staff);
  select count(*) into n from sales_lead_demos;
  if n < 5 then raise exception 'FAIL 6f: super admin sees % demos', n; end if;
  v := pg_temp.err(format('insert into sales_lead_demos (lead_id, scheduled_for, mode) values (%L, %L, ''phone'')', lead_paid, future1));
  if v = '' then raise exception 'FAIL 6g: direct insert allowed'; end if;
  v := pg_temp.err('update sales_lead_demos set status = ''held''');
  if v = '' then raise exception 'FAIL 6h: direct update allowed'; end if;
  v := pg_temp.err('delete from sales_lead_demos');
  if v = '' then raise exception 'FAIL 6i: direct delete allowed'; end if;

  -- the grant layer on its own (RLS has no write policies either, but neither layer should rely on the other)
  perform pg_temp.as_owner();
  if has_table_privilege('authenticated', 'public.sales_lead_demos', 'insert')
     or has_table_privilege('authenticated', 'public.sales_lead_demos', 'update')
     or has_table_privilege('authenticated', 'public.sales_lead_demos', 'delete')
     or has_table_privilege('authenticated', 'public.sales_lead_demos', 'truncate') then
    raise exception 'FAIL 6j: authenticated holds a write privilege on sales_lead_demos';
  end if;
  if has_table_privilege('anon', 'public.sales_lead_demos', 'select') or has_table_privilege('anon', 'public.sales_lead_demos', 'insert') then
    raise exception 'FAIL 6k: anon holds a privilege on sales_lead_demos';
  end if;
  if not has_table_privilege('authenticated', 'public.sales_lead_demos', 'select') then
    raise exception 'FAIL 6l: authenticated lost select';
  end if;
  if has_function_privilege('anon', 'public.admin_book_sales_lead_demo(uuid,timestamptz,text,text,uuid,uuid)', 'execute')
     or has_function_privilege('anon', 'public.admin_reschedule_sales_lead_demo(uuid,timestamptz,uuid)', 'execute')
     or has_function_privilege('anon', 'public.admin_set_sales_lead_demo_status(uuid,text,text,uuid)', 'execute') then
    raise exception 'FAIL 6m: anon can execute a demo function';
  end if;
  if has_function_privilege('authenticated', 'public._eat_date(timestamptz)', 'execute') then
    raise exception 'FAIL 6n: authenticated can execute the internal _eat_date helper';
  end if;

  -- ---------- 7. cleanup behaviour ----------
  delete from platform_team_members where id = rep;
  select count(*) into n from sales_lead_demos where lead_id = lead_new and host_id is null;
  if n <> 1 then raise exception 'FAIL 7a: removing a team member should keep the demo and clear the host (%)', n; end if;
  delete from sales_leads where id = lead_new;
  select count(*) into n from sales_lead_demos where lead_id = lead_new;
  if n <> 0 then raise exception 'FAIL 7b: deleting a lead left its demos (%)', n; end if;

  raise notice 'sales_lead_demos: all passed';
end $$;

rollback;
