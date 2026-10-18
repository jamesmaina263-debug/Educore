-- Behavioural tests for 20261018150000_trial_checkins.sql.
-- Same safety model as outbound_contact_log.sql: synthetic fixtures (.invalid addresses), impersonation via
-- request.jwt.claims, everything inside ONE transaction that ends in ROLLBACK, so nothing persists.
--   psql "$SUPABASE_DB_URL" -v ON_ERROR_STOP=1 -f supabase/tests/trial_checkins.sql
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
  trial_school uuid;
  no_sub_school uuid;
  log_id uuid;
  n integer;
  v text;
begin
  -- ---------- fixtures ----------
  insert into auth.users (id, aud, role, email) values
    (staff, 'authenticated', 'authenticated', 'tck-staff@example.invalid'),
    (nobody, 'authenticated', 'authenticated', 'tck-nobody@example.invalid');
  insert into school_users (school_id, auth_user_id, role_id, full_name, email) values
    (null, staff, (select id from roles where name = 'super_admin'), 'TCK Staff', 'tck-staff@example.invalid'),
    (null, nobody, (select id from roles where name = 'principal'), 'TCK Nobody', 'tck-nobody@example.invalid');
  insert into platform_team_members (id, name, email) values (rep, 'TCK Rep', 'tck-rep@example.invalid');

  insert into schools (name, slug) values ('TCK Trial School', 'tck-trial-school') returning id into trial_school;
  insert into schools (name, slug) values ('TCK No Subscription School', 'tck-no-sub-school') returning id into no_sub_school;
  insert into school_subscriptions (school_id, status, trial_ends_at) values (trial_school, 'trialing', now() + interval '20 days');

  -- ---------- 1. super admin can log; the row is stored as given ----------
  perform pg_temp.as_user(staff);
  log_id := admin_log_trial_checkin(trial_school, 'call', 'reached_interested', rep, '  wants a demo  ');
  perform pg_temp.as_owner();
  select count(*) into n from trial_checkins
   where id = log_id and school_id = trial_school and channel = 'call' and outcome = 'reached_interested'
     and performed_by = rep and note = 'wants a demo';
  if n <> 1 then raise exception 'FAIL 1: check-in row not stored as expected'; end if;

  -- optional fields may be null, blank note becomes null
  perform pg_temp.as_user(staff);
  log_id := admin_log_trial_checkin(trial_school, 'whatsapp', 'no_answer', null, '   ');
  perform pg_temp.as_owner();
  select count(*) into n from trial_checkins where id = log_id and performed_by is null and note is null;
  if n <> 1 then raise exception 'FAIL 1b: optional fields not null'; end if;

  -- ---------- 2. validation ----------
  perform pg_temp.as_user(staff);
  v := pg_temp.err(format('select admin_log_trial_checkin(%L, ''telegram'', ''no_answer'')', trial_school));
  if v <> 'Unknown channel.' then raise exception 'FAIL 2a: got %', v; end if;
  v := pg_temp.err(format('select admin_log_trial_checkin(%L, ''call'', ''converted'')', trial_school));
  if v <> 'Unknown outcome.' then raise exception 'FAIL 2b: got %', v; end if;
  v := pg_temp.err(format('select admin_log_trial_checkin(%L, ''call'', ''no_answer'', null, %L)', trial_school, repeat('x', 501)));
  if v not like 'Note is too long%' then raise exception 'FAIL 2c: got %', v; end if;
  v := pg_temp.err(format('select admin_log_trial_checkin(%L, ''call'', ''no_answer'')', gen_random_uuid()));
  if v <> 'School not found.' then raise exception 'FAIL 2d: got %', v; end if;
  v := pg_temp.err(format('select admin_log_trial_checkin(%L, ''call'', ''no_answer'')', no_sub_school));
  if v not like 'This school has no trial or subscription%' then raise exception 'FAIL 2e: got %', v; end if;
  v := pg_temp.err(format('select admin_log_trial_checkin(%L, ''call'', ''no_answer'', %L)', trial_school, gen_random_uuid()));
  if v <> 'Team member not found.' then raise exception 'FAIL 2f: got %', v; end if;

  -- the failed attempts wrote nothing (2 rows from section 1 only)
  perform pg_temp.as_owner();
  select count(*) into n from trial_checkins where school_id in (trial_school, no_sub_school);
  if n <> 2 then raise exception 'FAIL 2g: failed calls left rows behind (%)', n; end if;

  -- ---------- 3. access control ----------
  perform pg_temp.as_user(nobody);
  v := pg_temp.err(format('select admin_log_trial_checkin(%L, ''call'', ''no_answer'')', trial_school));
  if v <> 'Not authorized to log trial check-ins.' then raise exception 'FAIL 3a: non-admin got %', v; end if;
  select count(*) into n from trial_checkins;
  if n <> 0 then raise exception 'FAIL 3b: non-admin can read the log (%)', n; end if;

  perform pg_temp.as_anon();
  v := pg_temp.err(format('select admin_log_trial_checkin(%L, ''call'', ''no_answer'')', trial_school));
  if v = '' then raise exception 'FAIL 3c: anon could call the function'; end if;

  -- super admin reads; nobody can write the table directly
  perform pg_temp.as_user(staff);
  select count(*) into n from trial_checkins;
  if n <> 2 then raise exception 'FAIL 3d: super admin sees % rows', n; end if;
  v := pg_temp.err(format('insert into trial_checkins (school_id, channel, outcome) values (%L, ''call'', ''no_answer'')', trial_school));
  if v = '' then raise exception 'FAIL 3e: direct insert allowed'; end if;
  v := pg_temp.err('update trial_checkins set note = ''x''');
  if v = '' then raise exception 'FAIL 3f: direct update allowed'; end if;
  v := pg_temp.err('delete from trial_checkins');
  if v = '' then raise exception 'FAIL 3g: direct delete allowed'; end if;

  -- the grant layer on its own (RLS has no write policies either, but neither layer should rely on the other)
  perform pg_temp.as_owner();
  if has_table_privilege('authenticated', 'public.trial_checkins', 'insert')
     or has_table_privilege('authenticated', 'public.trial_checkins', 'update')
     or has_table_privilege('authenticated', 'public.trial_checkins', 'delete')
     or has_table_privilege('authenticated', 'public.trial_checkins', 'truncate') then
    raise exception 'FAIL 3h: authenticated holds a write privilege on trial_checkins';
  end if;
  if has_table_privilege('anon', 'public.trial_checkins', 'select')
     or has_table_privilege('anon', 'public.trial_checkins', 'insert') then
    raise exception 'FAIL 3i: anon holds a privilege on trial_checkins';
  end if;
  if not has_table_privilege('authenticated', 'public.trial_checkins', 'select') then
    raise exception 'FAIL 3j: authenticated lost select (RLS then has nothing to filter)';
  end if;
  if has_function_privilege('anon', 'public.admin_log_trial_checkin(uuid,text,text,uuid,text)', 'execute') then
    raise exception 'FAIL 3k: anon can execute admin_log_trial_checkin';
  end if;

  -- ---------- 4. cleanup behaviour ----------
  perform pg_temp.as_owner();
  delete from platform_team_members where id = rep;
  select count(*) into n from trial_checkins where school_id = trial_school and performed_by is null;
  if n <> 2 then raise exception 'FAIL 4a: removing a team member should keep the log (%)', n; end if;
  delete from trial_checkins where school_id = trial_school;
  delete from school_subscriptions where school_id = trial_school;
  delete from schools where id = trial_school;

  raise notice 'trial_checkins: all passed';
end $$;

rollback;
