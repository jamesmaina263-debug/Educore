-- Behavioural tests for 20261017150000_outbound_contact_log_and_opt_outs.sql.
-- Same safety model as platform_invoicing.sql: synthetic fixtures (.invalid addresses, 0700 000 xxx
-- style numbers), impersonation via request.jwt.claims, and everything inside ONE transaction that
-- ends in ROLLBACK, so nothing persists.
--   psql "$SUPABASE_DB_URL" -v ON_ERROR_STOP=1 -f supabase/tests/outbound_contact_log.sql
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
  r jsonb;
  n integer;
  v text;
  scored_id uuid;
  appr_id uuid;
  noemail_id uuid;
  rep uuid := gen_random_uuid();
  lead_id uuid;
  found_id uuid;
  lead2 uuid;
begin
  -- ---------- fixtures ----------
  insert into auth.users (id, aud, role, email) values
    (staff, 'authenticated', 'authenticated', 'ocl-staff@example.invalid'),
    (nobody, 'authenticated', 'authenticated', 'ocl-nobody@example.invalid');
  insert into school_users (school_id, auth_user_id, role_id, full_name, email) values
    (null, staff, (select id from roles where name = 'super_admin'), 'OCL Staff', 'ocl-staff@example.invalid'),
    (null, nobody, (select id from roles where name = 'principal'), 'OCL Nobody', 'ocl-nobody@example.invalid');
  insert into platform_team_members (id, name, email) values (rep, 'OCL Rep', 'ocl-rep@example.invalid');

  -- existing customers / requests / leads the import must dedupe against
  insert into schools (name, slug) values ('OCL Existing Customer School', 'ocl-existing-customer');
  insert into marketing_demo_requests (name, school_name, role, email, phone)
    values ('OCL Req', 'OCL Demo Requester School', 'Head', 'ocl-demo@example.invalid', '0700000001');
  insert into sales_leads (school_name, email, phone)
    values ('OCL Pipeline School', 'ocl-pipeline@example.invalid', '0700 000 002');

  -- ---------- 1. normalisation (owner context; function is internal) ----------
  perform pg_temp.as_owner();
  assert public._normalize_contact_identifier('phone', '0712 345 678') = '254712345678', 'phone 07xx';
  assert public._normalize_contact_identifier('phone', '+254 712-345-678') = '254712345678', 'phone +254';
  assert public._normalize_contact_identifier('phone', '254712345678') = '254712345678', 'phone 254';
  assert public._normalize_contact_identifier('phone', '712345678') = '254712345678', 'phone bare 9 digits';
  assert public._normalize_contact_identifier('phone', '0112345678') = '254112345678', 'phone 01xx';
  assert public._normalize_contact_identifier('phone', '+44 20 7946 0958') = '442079460958', 'foreign number kept as digits';
  assert public._normalize_contact_identifier('phone', 'abc') is null, 'junk phone';
  assert public._normalize_contact_identifier('phone', '123') is null, 'too short';
  assert public._normalize_contact_identifier('email', '  Foo@Example.INVALID ') = 'foo@example.invalid', 'email lower/trim';
  assert public._normalize_contact_identifier('email', 'not-an-email') is null, 'junk email';
  assert public._normalize_contact_identifier('email', null) is null, 'null';

  -- ---------- 2. access control ----------
  perform pg_temp.as_anon();
  assert pg_temp.err($q$select public.admin_is_outbound_contact_blocked('email','a@b.invalid')$q$) like '%permission denied%', 'anon cannot call blocked-check';
  assert pg_temp.err($q$select public.admin_log_outbound_contact(gen_random_uuid(),'email','replied')$q$) like '%permission denied%', 'anon cannot log';
  assert pg_temp.err($q$select public.admin_record_outbound_opt_out('email','a@b.invalid')$q$) like '%permission denied%', 'anon cannot opt out';
  assert pg_temp.err($q$select public._normalize_contact_identifier('email','a@b.invalid')$q$) like '%permission denied%', 'anon cannot call internal helper';
  assert pg_temp.err($q$select count(*) from public.outbound_contact_log$q$) like '%permission denied%', 'anon cannot read log';
  assert pg_temp.err($q$select count(*) from public.prospect_channel_opt_outs$q$) like '%permission denied%', 'anon cannot read opt-outs';

  perform pg_temp.as_user(nobody);
  assert pg_temp.err($q$select public.admin_is_outbound_contact_blocked('email','a@b.invalid')$q$) like '%Not authorized%', 'non-admin cannot call blocked-check';
  assert pg_temp.err($q$select public.admin_log_outbound_contact(gen_random_uuid(),'email','replied')$q$) like '%Not authorized%', 'non-admin cannot log';
  assert pg_temp.err($q$select public.admin_record_outbound_opt_out('whatsapp','0712345678')$q$) like '%Not authorized%', 'non-admin cannot opt out';
  assert pg_temp.err($q$select public._normalize_contact_identifier('email','a@b.invalid')$q$) like '%permission denied%', 'authenticated cannot call internal helper';
  assert (select count(*) from public.outbound_contact_log) = 0, 'non-admin sees no log rows (RLS)';
  assert pg_temp.err($q$insert into public.outbound_contact_log (prospect_id, channel, event) values (gen_random_uuid(),'email','sent')$q$) like '%permission denied%', 'no direct insert (log)';
  assert pg_temp.err($q$insert into public.prospect_channel_opt_outs (channel, identifier) values ('whatsapp','254712345678')$q$) like '%permission denied%', 'no direct insert (opt-outs)';
  assert pg_temp.err($q$delete from public.prospect_channel_opt_outs$q$) like '%permission denied%', 'no direct delete (opt-outs)';

  -- ---------- 3. import dedupe (as super admin) ----------
  perform pg_temp.as_user(staff);
  -- opt-outs recorded first, so the import below must skip those contacts
  assert public.admin_record_outbound_opt_out('email', 'OCL-Stopped@Example.invalid', 'requested') = 0, 'opt-out with no matching prospect';
  assert public.admin_record_outbound_opt_out('whatsapp', '+254 712 000 111', 'stop_reply', 'replied STOP') = 0, 'phone opt-out, no match yet';

  r := public.admin_import_outbound_prospects($j$[
    {"school_name":"OCL Fresh School A","town_county":"Nyeri","email":"ocl-a@example.invalid","phone":"0700 000 010","school_level":"primary"},
    {"school_name":"OCL Fresh School B","town_county":"Nyeri","email":"ocl-b@example.invalid"},
    {"school_name":"OCL Fresh School C","town_county":"Nyeri","phone":"0700 000 012"},
    {"school_name":"ocl existing customer school","town_county":"Nyeri"},
    {"school_name":"OCL Brand New Name","email":"OCL-DEMO@example.invalid"},
    {"school_name":"ocl demo requester school"},
    {"school_name":"OCL Another Name","email":"ocl-pipeline@example.invalid"},
    {"school_name":"OCL Third Name","phone":"+254700000002"},
    {"school_name":"OCL Stopped Email School","email":"ocl-stopped@example.invalid"},
    {"school_name":"OCL Stopped Phone School","phone":"0712000111"},
    {"school_name":"OCL Fresh School A","town_county":"Nyeri"},
    {"school_name":"   "}
  ]$j$::jsonb, 'ocl test import');
  assert (r ->> 'inserted')::int = 3, 'inserted 3 fresh schools, got ' || (r ->> 'inserted');
  assert (r ->> 'skipped')::int = 9, 'skipped 9, got ' || (r ->> 'skipped');
  assert (r ->> 'skipped_opted_out')::int = 2, 'skipped 2 opted-out, got ' || (r ->> 'skipped_opted_out');
  assert not exists (select 1 from outbound_prospects where school_name in (
    'OCL Brand New Name','OCL Another Name','OCL Third Name','OCL Stopped Email School','OCL Stopped Phone School',
    'ocl existing customer school','ocl demo requester school')), 'deduped/opted-out schools were not inserted';

  -- re-import is a no-op for the schools already inserted
  r := public.admin_import_outbound_prospects('[{"school_name":"OCL Fresh School B","town_county":"Nyeri"}]'::jsonb, 'again');
  assert (r ->> 'inserted')::int = 0 and (r ->> 'skipped')::int = 1, 're-import inserts nothing';

  -- ---------- 4. contact log gating ----------
  select id into scored_id from outbound_prospects where school_name = 'OCL Fresh School A';
  select id into appr_id from outbound_prospects where school_name = 'OCL Fresh School B';
  select id into noemail_id from outbound_prospects where school_name = 'OCL Fresh School C';

  -- not yet approved -> cannot be contacted
  perform admin_set_outbound_prospect_scoring(scored_id, 70, 'ok', 's', 'b', 'w');
  v := pg_temp.err(format($q$select public.admin_log_outbound_contact(%L,'email','draft_copied')$q$, scored_id));
  assert v like '%Only an approved prospect%', 'unapproved prospect cannot be contacted: ' || v;
  -- ... but hearing back from one is still recorded
  assert public.admin_log_outbound_contact(scored_id, 'email', 'replied', rep, 'they wrote first') is not null, 'replied allowed on any status';

  perform admin_set_outbound_prospect_scoring(appr_id, 80, 'ok', 's', 'b', 'w');
  perform admin_review_outbound_prospect(appr_id, 'approved');
  perform admin_set_outbound_prospect_scoring(noemail_id, 60, 'ok', 's', 'b', 'w');
  perform admin_review_outbound_prospect(noemail_id, 'approved');

  assert public.admin_log_outbound_contact(appr_id, 'email', 'draft_copied', rep) is not null, 'approved prospect: draft_copied logged';
  assert public.admin_log_outbound_contact(appr_id, 'email', 'sent', rep, 'sent from my mailbox') is not null, 'approved prospect: sent logged';
  assert (select count(*) from outbound_contact_log where prospect_id = appr_id and performed_by = rep) = 2, 'rep recorded on rows';

  v := pg_temp.err(format($q$select public.admin_log_outbound_contact(%L,'whatsapp','sent')$q$, appr_id));
  assert v like '%no usable contact%', 'no phone -> cannot log whatsapp: ' || v;
  v := pg_temp.err(format($q$select public.admin_log_outbound_contact(%L,'email','sent')$q$, noemail_id));
  assert v like '%no usable contact%', 'no email -> cannot log email: ' || v;
  v := pg_temp.err(format($q$select public.admin_log_outbound_contact(%L,'email','opted_out')$q$, appr_id));
  assert v like '%admin_record_outbound_opt_out%', 'opted_out cannot be logged directly: ' || v;
  v := pg_temp.err(format($q$select public.admin_log_outbound_contact(%L,'email','shouted')$q$, appr_id));
  assert v like '%Event must be%', 'unknown event rejected: ' || v;
  v := pg_temp.err(format($q$select public.admin_log_outbound_contact(%L,'telegram','sent')$q$, appr_id));
  assert v like '%Unknown channel%', 'unknown channel rejected: ' || v;
  v := pg_temp.err($q$select public.admin_log_outbound_contact(gen_random_uuid(),'email','sent')$q$);
  assert v like '%not found%', 'unknown prospect rejected: ' || v;
  v := pg_temp.err(format($q$select public.admin_log_outbound_contact(%L,'email','sent',gen_random_uuid())$q$, appr_id));
  assert v like '%foreign key%', 'unknown rep rejected by FK: ' || v;

  -- ---------- 5. opt-out after the fact blocks further contact ----------
  assert public.admin_is_outbound_contact_blocked('whatsapp', '0700000012') = false, 'not blocked before opt-out';
  -- three spellings of the same number are one opt-out
  assert public.admin_record_outbound_opt_out('whatsapp', '0700 000 012', 'stop_reply') = 1, 'opt-out matches the prospect';
  assert public.admin_record_outbound_opt_out('whatsapp', '+254700000012', 'stop_reply') = 0, 'second spelling is idempotent (no new log row)';
  assert public.admin_record_outbound_opt_out('whatsapp', '254700000012', 'requested') = 0, 'third spelling is idempotent';
  assert (select count(*) from prospect_channel_opt_outs where identifier = '254700000012') = 1, 'exactly one opt-out row';
  assert (select count(*) from outbound_contact_log where prospect_id = noemail_id and event = 'opted_out' and channel = 'whatsapp') = 1, 'one opted_out log row';
  assert public.admin_is_outbound_contact_blocked('whatsapp', '+254 700 000 012') = true, 'blocked after opt-out';
  assert public.admin_is_outbound_contact_blocked('sms', '0700000012') = false, 'opt-out is per channel';
  v := pg_temp.err(format($q$select public.admin_log_outbound_contact(%L,'whatsapp','draft_copied')$q$, noemail_id));
  assert v like '%opted out%', 'opted-out number cannot be logged as contacted: ' || v;

  -- email goes to the existing suppression list (single source of truth)
  assert public.admin_record_outbound_opt_out('email', 'OCL-B@Example.invalid', 'requested') = 1, 'email opt-out matches prospect B';
  perform pg_temp.as_owner(); -- the suppression table is service-only; clients cannot read it directly
  assert exists (select 1 from public.marketing_email_suppressions where email = 'ocl-b@example.invalid' and reason = 'unsubscribed'), 'written to marketing_email_suppressions';
  perform pg_temp.as_user(staff);
  assert public.admin_is_outbound_contact_blocked('email', 'ocl-b@example.invalid') = true, 'email blocked';
  v := pg_temp.err(format($q$select public.admin_log_outbound_contact(%L,'email','sent')$q$, appr_id));
  assert v like '%opted out%', 'suppressed email cannot be logged as contacted: ' || v;
  v := pg_temp.err($q$select public.admin_record_outbound_opt_out('email','nonsense')$q$);
  assert v like '%valid email%', 'bad email rejected: ' || v;
  v := pg_temp.err($q$select public.admin_record_outbound_opt_out('phone','12')$q$);
  assert v like '%valid phone%', 'bad phone rejected: ' || v;
  v := pg_temp.err($q$select public.admin_record_outbound_opt_out('phone','0712345678','whenever')$q$);
  assert v like '%Reason must be%', 'bad reason rejected: ' || v;

  -- ---------- 6. promotion records the outbound source ----------
  lead_id := public.admin_promote_outbound_prospect(appr_id);
  assert (select source from sales_leads where id = lead_id) = 'outbound', 'promoted lead source is outbound';
  -- ---------- 6b. found (scraped / AI) contacts stay unusable until a person confirms them ----------
  -- Also guards 20261017120000_outbound_contact_enrichment.sql's promotion gate against being overwritten.
  perform public.admin_import_outbound_prospects('[{"school_name":"OCL Found Contacts School","town_county":"Nyeri"}]'::jsonb, 'ocl found');
  select id into found_id from outbound_prospects where school_name = 'OCL Found Contacts School';
  perform admin_set_outbound_prospect_scoring(found_id, 75, 'ok', 's', 'b', 'w');
  perform admin_review_outbound_prospect(found_id, 'approved');
  assert public.admin_set_outbound_prospect_contacts(found_id, null, '0700000030', 'ocl-found@example.invalid', null, null,
    'https://example.invalid/contact', 'scraped') = true, 'found contacts stored';
  assert (select contact_status from outbound_prospects where id = found_id) = 'scraped', 'status is scraped';

  v := pg_temp.err(format($q$select public.admin_log_outbound_contact(%L,'email','draft_copied')$q$, found_id));
  assert v like '%Confirm the found contact details before contacting%', 'unconfirmed email cannot be contacted: ' || v;
  v := pg_temp.err(format($q$select public.admin_log_outbound_contact(%L,'whatsapp','sent')$q$, found_id));
  assert v like '%Confirm the found contact details before contacting%', 'unconfirmed phone cannot be contacted: ' || v;
  v := pg_temp.err(format($q$select public.admin_promote_outbound_prospect(%L)$q$, found_id));
  assert v like '%Confirm the found contact details before adding%', 'promotion still refuses unconfirmed contacts: ' || v;

  perform public.admin_confirm_outbound_prospect_contacts(found_id);
  assert public.admin_log_outbound_contact(found_id, 'email', 'draft_copied', rep) is not null, 'confirmed contact can be logged';
  lead2 := public.admin_promote_outbound_prospect(found_id);
  assert (select source from sales_leads where id = lead2) = 'outbound', 'source outbound after confirmation';
  assert (select notes from sales_leads where id = lead2) like '%Contact source: https://example.invalid/contact%', 'promotion still carries the contact source';

  -- the widened CHECK still rejects unknown sources (checked as owner: clients cannot write the table)
  perform pg_temp.as_owner();
  v := pg_temp.err(format($q$update public.sales_leads set source = 'telepathy' where id = %L$q$, lead_id));
  assert v like '%sales_leads_source_check%', 'unknown lead source still rejected: ' || v;
  assert pg_temp.err(format($q$update public.sales_leads set source = 'whatsapp' where id = %L$q$, lead_id)) = '', 'existing sources still accepted';
  perform pg_temp.as_user(staff);

  -- ---------- 7. deleting a prospect removes its contact log; promoted ones are protected ----------
  assert exists (select 1 from outbound_contact_log where prospect_id = scored_id), 'log row exists before delete';
  perform public.admin_delete_outbound_prospect(scored_id);
  assert not exists (select 1 from outbound_contact_log where prospect_id = scored_id), 'log rows deleted with the prospect';
  v := pg_temp.err(format($q$select public.admin_delete_outbound_prospect(%L)$q$, appr_id));
  assert v like '%already in the sales pipeline%', 'promoted prospect cannot be deleted: ' || v;
  assert exists (select 1 from outbound_contact_log where prospect_id = appr_id), 'promoted prospect keeps its log';

  raise notice 'outbound contact log behavioural checks all passed';
end $$;

rollback;
