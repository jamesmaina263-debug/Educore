-- Behavioural tests for 20261019160000_sales_whatsapp_consent_queue.sql.
-- Same safety model as the other supabase/tests files: synthetic fixtures (.invalid addresses, 25470000xxxx numbers),
-- impersonation via request.jwt.claims, everything inside ONE transaction that ends in ROLLBACK, so nothing persists.
-- Nothing is ever sent: this feature has no provider at all in this version.
--   psql "$SUPABASE_DB_URL" -v ON_ERROR_STOP=1 -f supabase/tests/sales_whatsapp.sql
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

do $$
declare
  staff uuid := gen_random_uuid();
  nobody uuid := gen_random_uuid();
  rep uuid := gen_random_uuid();
  rep2 uuid := gen_random_uuid();
  demo_id uuid := gen_random_uuid();
  sch uuid;
  c_a uuid; c_b uuid; c_p uuid; c_w uuid; c_o uuid; c_cap uuid; c_x uuid;
  m1 uuid; m2 uuid; m3 uuid; m4 uuid; m5 uuid;
  hash1 text; hash2 text;
  j jsonb;
  v text;
  s text;
  n integer;
  u uuid;
begin
  -- ---------- fixtures ----------
  insert into auth.users (id, aud, role, email) values
    (staff, 'authenticated', 'authenticated', 'wa-staff@example.invalid'),
    (nobody, 'authenticated', 'authenticated', 'wa-nobody@example.invalid');
  insert into school_users (school_id, auth_user_id, role_id, full_name, email) values
    (null, staff, (select id from roles where name = 'super_admin'), 'WA Staff', 'wa-staff@example.invalid'),
    (null, nobody, (select id from roles where name = 'principal'), 'WA Nobody', 'wa-nobody@example.invalid');
  insert into platform_team_members (id, name, email) values (rep, 'WA Rep', 'wa-rep@example.invalid'), (rep2, 'WA Rep Two', 'wa-rep2@example.invalid');
  insert into schools (name, slug) values ('WA Trial School', 'wa-trial-school') returning id into sch;
  insert into marketing_demo_requests (id, name, school_name, role, email, phone) values (demo_id, 'Demo Person', 'Demo School', 'Principal', 'demo@example.invalid', '0700 000 001');

  -- ---------- 0. the promotional switch defaults OFF ----------
  perform pg_temp.as_user(staff);
  if (select promotional_enabled from admin_get_sales_whatsapp_settings()) then raise exception 'FAIL 0a: promotional is on by default'; end if;

  -- ---------- 1. the public path: the demo form's tick-box ----------
  perform pg_temp.as_service();
  c_a := record_demo_whatsapp_consent(demo_id, '  Demo Person ', 'Demo School', '0700 000 001', 'Yes, you may message me on WhatsApp about my demo request.');
  perform pg_temp.as_owner();
  select count(*) into n from whatsapp_consents
   where id = c_a and phone = '254700000001' and contact_name = 'Demo Person' and school_name = 'Demo School' and source = 'demo_form'
     and scope = 'service' and consent_text = 'Yes, you may message me on WhatsApp about my demo request.' and demo_request_id = demo_id and withdrawn_at is null;
  if n <> 1 then raise exception 'FAIL 1a: demo-form agreement not stored as expected'; end if;

  perform pg_temp.as_service();
  u := record_demo_whatsapp_consent(demo_id, 'Demo Person', 'Demo School', '+254 700-000-001', 'Other words');   -- same number again
  if u is distinct from c_a then raise exception 'FAIL 1b: same number created a second agreement'; end if;
  if record_demo_whatsapp_consent(demo_id, 'X', 'Y', 'not a number', 'words') is not null then raise exception 'FAIL 1c: unusable number recorded'; end if;
  if record_demo_whatsapp_consent(demo_id, 'X', 'Y', '0700000002', '   ') is not null then raise exception 'FAIL 1d: empty wording recorded'; end if;
  if record_demo_whatsapp_consent(demo_id, '  ', 'Y', '0700000002', 'words') is not null then raise exception 'FAIL 1e: empty name recorded'; end if;
  if record_demo_whatsapp_consent(demo_id, 'X', 'Y', '0700000002', repeat('x', 601)) is not null then raise exception 'FAIL 1f: over-long wording recorded'; end if;
  c_x := record_demo_whatsapp_consent(gen_random_uuid(), 'No Request', 'Y', '0700000003', 'words');
  perform pg_temp.as_owner();
  select count(*) into n from whatsapp_consents where id = c_x and demo_request_id is null;
  if n <> 1 then raise exception 'FAIL 1g: unknown request id should record the agreement with no link'; end if;
  select count(*) into n from whatsapp_consents where phone in ('254700000001', '254700000002', '254700000003');
  if n <> 2 then raise exception 'FAIL 1h: expected exactly 2 agreements (%)', n; end if;

  -- a number that already opted out cannot be re-added through the public form
  insert into prospect_channel_opt_outs (channel, identifier, reason) values ('whatsapp', '254700000009', 'requested');
  perform pg_temp.as_service();
  if record_demo_whatsapp_consent(demo_id, 'Opted Out', 'Y', '0700000009', 'words') is not null then raise exception 'FAIL 1i: opted-out number was re-added'; end if;

  -- only the service role can call it
  perform pg_temp.as_user(staff);
  v := pg_temp.err(format('select record_demo_whatsapp_consent(%L, ''A'', ''B'', ''0700000004'', ''words'')', demo_id));
  if v = '' then raise exception 'FAIL 1j: an authenticated user called the public-path function'; end if;
  perform pg_temp.as_anon();
  v := pg_temp.err(format('select record_demo_whatsapp_consent(%L, ''A'', ''B'', ''0700000004'', ''words'')', demo_id));
  if v = '' then raise exception 'FAIL 1k: anon called the public-path function'; end if;

  -- ---------- 2. a team member records an agreement ----------
  perform pg_temp.as_user(staff);
  c_b := admin_record_whatsapp_consent('0711 000 002', '  Owner B ', 'Trial School B', 'call', 'service_and_promotional', '  agreed on Tuesday  ', sch, rep);
  perform pg_temp.as_owner();
  select count(*) into n from whatsapp_consents
   where id = c_b and phone = '254711000002' and contact_name = 'Owner B' and source = 'team_recorded' and scope = 'service_and_promotional'
     and how = 'call' and school_id = sch and recorded_by = rep and note = 'agreed on Tuesday' and consent_text like 'Agreed to be contacted on WhatsApp (call)%';
  if n <> 1 then raise exception 'FAIL 2a: team-recorded agreement not stored as expected'; end if;
  perform pg_temp.as_user(staff);
  v := pg_temp.err('select admin_record_whatsapp_consent(''0711000003'', ''N'', null, ''call'', ''service'', null, null, null)');
  if v <> 'Say who is recording this agreement.' then raise exception 'FAIL 2b: got %', v; end if;
  v := pg_temp.err(format('select admin_record_whatsapp_consent(''abc'', ''N'', null, ''call'', ''service'', null, null, %L)', rep));
  if v <> 'That is not a usable phone number.' then raise exception 'FAIL 2c: got %', v; end if;
  v := pg_temp.err(format('select admin_record_whatsapp_consent(''0711000003'', ''  '', null, ''call'', ''service'', null, null, %L)', rep));
  if v not like 'Enter the person''s name%' then raise exception 'FAIL 2d: got %', v; end if;
  v := pg_temp.err(format('select admin_record_whatsapp_consent(''0711000003'', ''N'', null, ''telepathy'', ''service'', null, null, %L)', rep));
  if v <> 'Say how they agreed.' then raise exception 'FAIL 2e: got %', v; end if;
  v := pg_temp.err(format('select admin_record_whatsapp_consent(''0711000003'', ''N'', null, ''call'', ''everything'', null, null, %L)', rep));
  if v <> 'Choose what they agreed to.' then raise exception 'FAIL 2f: got %', v; end if;
  v := pg_temp.err(format('select admin_record_whatsapp_consent(''0711000003'', ''N'', null, ''call'', ''service'', %L, null, %L)', repeat('x', 501), rep));
  if v not like 'Note is too long%' then raise exception 'FAIL 2g: got %', v; end if;
  v := pg_temp.err(format('select admin_record_whatsapp_consent(''0711000003'', ''N'', null, ''call'', ''service'', null, %L, %L)', gen_random_uuid(), rep));
  if v <> 'School not found.' then raise exception 'FAIL 2h: got %', v; end if;
  v := pg_temp.err(format('select admin_record_whatsapp_consent(''0700000009'', ''N'', null, ''call'', ''service'', null, null, %L)', rep));
  if v not like 'This number has opted out of WhatsApp messages and cannot be added again.%' then raise exception 'FAIL 2i: got %', v; end if;
  v := pg_temp.err(format('select admin_record_whatsapp_consent(''0711000002'', ''N'', null, ''call'', ''service'', null, null, %L)', rep));
  if v <> 'This number already has an active agreement.' then raise exception 'FAIL 2j: got %', v; end if;

  -- ---------- 3. message content rules ----------
  v := pg_temp.err(format('select admin_propose_sales_whatsapp(%L, ''service'', %L, %L)', c_a, 'Hi {{name}}, your trial is running.', rep));
  if v not like 'Write the person''s name directly%' then raise exception 'FAIL 3a: got %', v; end if;
  v := pg_temp.err(format('select admin_propose_sales_whatsapp(%L, ''service'', %L, %L)', c_a, repeat('x', 1001), rep));
  if v <> 'Message is too long (max 1000 characters).' then raise exception 'FAIL 3b: got %', v; end if;
  v := pg_temp.err(format('select admin_propose_sales_whatsapp(%L, ''service'', %L, %L)', c_a, 'We offer no obligation', rep));
  if v not like 'Remove "no obligation"%' then raise exception 'FAIL 3c: got %', v; end if;
  v := pg_temp.err(format('select admin_propose_sales_whatsapp(%L, ''service'', %L, %L)', c_a, 'See https://bit.ly/x', rep));
  if v not like 'Links and addresses may only point to educoreafrica.com%' then raise exception 'FAIL 3d: got %', v; end if;
  v := pg_temp.err(format('select admin_propose_sales_whatsapp(%L, ''service'', %L, %L)', c_a, 'Get a discount today', rep));
  if v <> 'This reads like an offer. Send it as a promotional message instead.' then raise exception 'FAIL 3e: got %', v; end if;
  v := pg_temp.err(format('select admin_propose_sales_whatsapp(%L, ''service'', %L, %L)', c_a, '   ', rep));
  if v <> 'Message is required.' then raise exception 'FAIL 3f: got %', v; end if;
  v := pg_temp.err(format('select admin_propose_sales_whatsapp(%L, ''service'', %L, null)', c_a, 'Hello'));
  if v <> 'Say who is proposing this message.' then raise exception 'FAIL 3g: got %', v; end if;
  v := pg_temp.err(format('select admin_propose_sales_whatsapp(%L, ''service'', %L, %L)', gen_random_uuid(), 'Hello', rep));
  if v <> 'Agreement record not found.' then raise exception 'FAIL 3h: got %', v; end if;

  -- ---------- 4. who may be messaged, and for what ----------
  v := pg_temp.err(format('select admin_propose_sales_whatsapp(%L, ''promotional'', %L, %L)', c_a, 'A special offer for you', rep));
  if v <> 'This person agreed to messages about their demo and trial only, not promotional ones.' then raise exception 'FAIL 4a: got %', v; end if;
  m1 := admin_propose_sales_whatsapp(c_a, 'service', 'Hello Demo Person, thanks for requesting a demo. When suits you? See https://www.educoreafrica.com/contact', rep);
  perform pg_temp.as_owner();
  select count(*) into n from sales_whatsapp_messages
   where id = m1 and consent_id = c_a and phone = '254700000001' and recipient_name = 'Demo Person' and kind = 'service'
     and status = 'proposed' and proposed_by = rep and payload_hash ~ '^[0-9a-f]{64}$';
  if n <> 1 then raise exception 'FAIL 4b: proposal not stored as expected'; end if;
  select payload_hash into hash1 from sales_whatsapp_messages where id = m1;

  perform pg_temp.as_user(staff);
  v := pg_temp.err(format('select admin_propose_sales_whatsapp(%L, ''service'', %L, %L)', c_a, 'Another message', rep));
  if v <> 'This person already has a message waiting to be reviewed or sent.' then raise exception 'FAIL 4c: got %', v; end if;

  -- ---------- 5. editing, and approval bound to the exact text ----------
  perform admin_edit_sales_whatsapp(m1, 'Hello Demo Person, thanks for asking for a demo. What time suits you?');
  select payload_hash into hash2 from sales_whatsapp_messages where id = m1;
  if hash2 = hash1 then raise exception 'FAIL 5a: editing did not change the hash'; end if;
  v := pg_temp.err(format('select admin_edit_sales_whatsapp(%L, %L)', m1, 'We offer no obligation'));
  if v not like 'Remove "no obligation"%' then raise exception 'FAIL 5b: edit skipped content rules: %', v; end if;
  v := pg_temp.err(format('select admin_review_sales_whatsapp(%L, ''approve'', %L, %L)', m1, hash1, rep2));
  if v <> 'This message changed since you opened it. Reload and review it again.' then raise exception 'FAIL 5c: stale hash got %', v; end if;
  v := pg_temp.err(format('select admin_review_sales_whatsapp(%L, ''approve'', %L, null)', m1, hash2));
  if v <> 'Say who is reviewing this message.' then raise exception 'FAIL 5d: got %', v; end if;
  v := pg_temp.err(format('select admin_review_sales_whatsapp(%L, ''maybe'', %L, %L)', m1, hash2, rep2));
  if v <> 'Decision must be approve or reject.' then raise exception 'FAIL 5e: got %', v; end if;
  s := admin_review_sales_whatsapp(m1, 'approve', hash2, rep2, '  fine  ');
  if s <> 'approved' then raise exception 'FAIL 5f: got %', s; end if;
  perform pg_temp.as_owner();
  select count(*) into n from sales_whatsapp_messages where id = m1 and status = 'approved' and approved_hash = payload_hash and reviewed_by = rep2 and review_note = 'fine';
  if n <> 1 then raise exception 'FAIL 5g: approval not recorded as expected'; end if;
  perform pg_temp.as_user(staff);
  s := admin_review_sales_whatsapp(m1, 'approve', hash2, rep2);
  if s <> 'approved' then raise exception 'FAIL 5h: repeat approve got %', s; end if;
  v := pg_temp.err(format('select admin_review_sales_whatsapp(%L, ''reject'', null, %L)', m1, rep2));
  if v <> 'This message is already approved.' then raise exception 'FAIL 5i: got %', v; end if;
  v := pg_temp.err(format('select admin_edit_sales_whatsapp(%L, ''Sneaky change'')', m1));
  if v not like 'Only a message that has not been approved can be edited%' then raise exception 'FAIL 5j: approved text was editable: %', v; end if;

  -- ---------- 6. marking sent ----------
  v := pg_temp.err(format('select admin_mark_sales_whatsapp_sent(%L, null)', m1));
  if v <> 'Say who sent this message.' then raise exception 'FAIL 6a: got %', v; end if;
  perform pg_temp.as_owner();
  update sales_whatsapp_messages set body = body || ' PS: pay now' where id = m1;   -- out-of-band edit of approved text
  perform pg_temp.as_user(staff);
  j := admin_mark_sales_whatsapp_sent(m1, rep);
  if (j->>'ok')::boolean or j->>'message' <> 'The message no longer matches what was approved.' then raise exception 'FAIL 6b: got %', j; end if;
  perform pg_temp.as_owner();
  update sales_whatsapp_messages set body = 'Hello Demo Person, thanks for asking for a demo. What time suits you?' where id = m1;
  insert into prospect_channel_opt_outs (channel, identifier, reason) values ('whatsapp', '254700000001', 'stop_reply');   -- opted out after approval
  perform pg_temp.as_user(staff);
  j := admin_mark_sales_whatsapp_sent(m1, rep);
  if (j->>'ok')::boolean or j->>'message' <> 'This number has opted out of WhatsApp messages.' then raise exception 'FAIL 6c: got %', j; end if;
  perform pg_temp.as_owner();
  delete from prospect_channel_opt_outs where identifier = '254700000001';
  perform pg_temp.as_user(staff);
  j := admin_mark_sales_whatsapp_sent(m1, rep2);
  if not (j->>'ok')::boolean then raise exception 'FAIL 6d: refused a valid mark-sent: %', j; end if;
  perform pg_temp.as_owner();
  select count(*) into n from sales_whatsapp_messages where id = m1 and status = 'sent' and sent_at is not null and sent_by = rep2 and send_method = 'manual';
  if n <> 1 then raise exception 'FAIL 6e: sent state not recorded as expected'; end if;
  perform pg_temp.as_user(staff);
  j := admin_mark_sales_whatsapp_sent(m1, rep2);
  if not coalesce((j->>'already_sent')::boolean, false) then raise exception 'FAIL 6f: repeat mark-sent got %', j; end if;
  v := pg_temp.err(format('select admin_mark_sales_whatsapp_sent(%L, %L)', gen_random_uuid(), rep));
  if v <> 'Message not found.' then raise exception 'FAIL 6g: got %', v; end if;

  -- ---------- 7. frequency ----------
  v := pg_temp.err(format('select admin_propose_sales_whatsapp(%L, ''service'', %L, %L)', c_a, 'Following up', rep));
  if v <> 'This person was messaged, or has an approved message waiting, in the last 2 days.' then raise exception 'FAIL 7a: got %', v; end if;
  -- two promotional messages already sent (10 and 20 days ago): a third is refused even though the 2-day gap is clear
  c_p := admin_record_whatsapp_consent('0722 000 005', 'Promo Person', null, 'email', 'service_and_promotional', null, null, rep);
  perform pg_temp.as_owner();
  insert into sales_whatsapp_messages (consent_id, phone, recipient_name, kind, body, payload_hash, status, approved_hash, sent_at, created_at)
  select c_p, '254722000005', 'Promo Person', 'promotional', 'Old ' || d, 'h' || d, 'sent', 'h' || d, now() - (d || ' days')::interval, now() - (d || ' days')::interval
  from unnest(array[10, 20]) as d;
  perform pg_temp.as_user(staff);
  v := pg_temp.err(format('select admin_propose_sales_whatsapp(%L, ''promotional'', %L, %L)', c_p, 'A third offer', rep));
  if v <> 'This person already has 2 promotional messages in the last 30 days.' then raise exception 'FAIL 7b: got %', v; end if;
  v := pg_temp.err(format('select admin_propose_sales_whatsapp(%L, ''service'', %L, %L)', c_p, 'A service note', rep));
  if v <> '' then raise exception 'FAIL 7c: the promotional cap blocked a service message: %', v; end if;
  perform admin_withdraw_sales_whatsapp((select id from sales_whatsapp_messages where consent_id = c_p and status = 'proposed'));

  -- ---------- 8. promotional has its own switch ----------
  m2 := admin_propose_sales_whatsapp(c_b, 'promotional', 'A special offer for your school: details at https://www.educoreafrica.com/pricing', rep);
  select payload_hash into hash1 from sales_whatsapp_messages where id = m2;
  v := pg_temp.err(format('select admin_review_sales_whatsapp(%L, ''approve'', %L, %L)', m2, hash1, rep2));
  if v <> 'Promotional WhatsApp messages are switched off.' then raise exception 'FAIL 8a: got %', v; end if;
  v := pg_temp.err('select admin_set_sales_whatsapp_settings(true, null)');
  if v <> 'Say who you are before changing this switch.' then raise exception 'FAIL 8b: got %', v; end if;
  perform admin_set_sales_whatsapp_settings(true, rep);
  s := admin_review_sales_whatsapp(m2, 'approve', hash1, rep2);
  if s <> 'approved' then raise exception 'FAIL 8c: got %', s; end if;
  perform admin_set_sales_whatsapp_settings(false, rep);   -- switched off again after approval
  j := admin_mark_sales_whatsapp_sent(m2, rep);
  if (j->>'ok')::boolean or j->>'message' <> 'Promotional WhatsApp messages are switched off.' then raise exception 'FAIL 8d: got %', j; end if;
  perform admin_set_sales_whatsapp_settings(true, rep);
  j := admin_mark_sales_whatsapp_sent(m2, rep);
  if not (j->>'ok')::boolean then raise exception 'FAIL 8e: refused a valid promotional mark-sent: %', j; end if;

  -- ---------- 9. expiry ----------
  c_o := admin_record_whatsapp_consent('0733 000 006', 'Expiry Person', null, 'call', 'service', null, null, rep);
  m3 := admin_propose_sales_whatsapp(c_o, 'service', 'Hello, a quick note about your trial.', rep);
  select payload_hash into hash1 from sales_whatsapp_messages where id = m3;
  perform pg_temp.as_owner();
  update sales_whatsapp_messages set created_at = now() - interval '8 days' where id = m3;
  perform pg_temp.as_user(staff);
  s := admin_review_sales_whatsapp(m3, 'approve', hash1, rep);
  if s <> 'expired' then raise exception 'FAIL 9a: old proposal got %', s; end if;
  perform pg_temp.as_owner();
  select status into s from sales_whatsapp_messages where id = m3;
  if s <> 'expired' then raise exception 'FAIL 9b: expiry not recorded (%)', s; end if;
  perform pg_temp.as_user(staff);
  m3 := admin_propose_sales_whatsapp(c_o, 'service', 'Hello, a quick note about your trial.', rep);
  select payload_hash into hash1 from sales_whatsapp_messages where id = m3;
  perform admin_review_sales_whatsapp(m3, 'approve', hash1, rep);
  perform pg_temp.as_owner();
  update sales_whatsapp_messages set reviewed_at = now() - interval '25 hours' where id = m3;
  perform pg_temp.as_user(staff);
  j := admin_mark_sales_whatsapp_sent(m3, rep);
  if (j->>'ok')::boolean or j->>'message' not like 'The approval expired after 24 hours%' then raise exception 'FAIL 9c: got %', j; end if;
  perform pg_temp.as_owner();
  select status into s from sales_whatsapp_messages where id = m3;
  if s <> 'expired' then raise exception 'FAIL 9d: lapsed approval not recorded (%)', s; end if;

  -- ---------- 10. platform-wide daily limit ----------
  perform pg_temp.as_user(staff);
  c_cap := admin_record_whatsapp_consent('0744 000 007', 'Cap Person', null, 'call', 'service', null, null, rep);
  perform pg_temp.as_owner();
  insert into sales_whatsapp_messages (consent_id, phone, recipient_name, kind, body, payload_hash, status, approved_hash, sent_at)
  select c_cap, '254744000007', 'Cap Person', 'service', 'Bulk ' || g, 'b' || g, 'sent', 'b' || g, now() - interval '1 hour' from generate_series(1, 40) g;
  perform pg_temp.as_user(staff);
  m4 := admin_propose_sales_whatsapp(c_o, 'service', 'Hello again about your trial.', rep);
  select payload_hash into hash1 from sales_whatsapp_messages where id = m4;
  perform admin_review_sales_whatsapp(m4, 'approve', hash1, rep);
  j := admin_mark_sales_whatsapp_sent(m4, rep);
  if (j->>'ok')::boolean or j->>'message' not like 'Daily limit reached%' then raise exception 'FAIL 10a: got %', j; end if;

  -- a message that was never approved cannot be marked sent (checked here with no other rule in the way)
  m5 := admin_propose_sales_whatsapp(c_x, 'service', 'Hello, a note about your trial.', rep);
  j := admin_mark_sales_whatsapp_sent(m5, rep);
  if (j->>'ok')::boolean or j->>'message' <> 'Only an approved message can be marked as sent (this one is proposed).' then raise exception 'FAIL 10b: got %', j; end if;
  perform admin_withdraw_sales_whatsapp(m5);

  -- ---------- 11. withdrawing a message ----------
  perform admin_withdraw_sales_whatsapp(m4);
  perform admin_withdraw_sales_whatsapp(m4);   -- repeat: no-op
  v := pg_temp.err(format('select admin_withdraw_sales_whatsapp(%L)', m1));
  if v <> 'A message that is already sent cannot be withdrawn.' then raise exception 'FAIL 11a: got %', v; end if;
  v := pg_temp.err(format('select admin_withdraw_sales_whatsapp(%L)', gen_random_uuid()));
  if v <> 'Message not found.' then raise exception 'FAIL 11b: got %', v; end if;
  j := admin_mark_sales_whatsapp_sent(m4, rep);
  if (j->>'ok')::boolean then raise exception 'FAIL 11c: a withdrawn message was marked sent'; end if;

  -- ---------- 12. withdrawing an agreement ----------
  c_w := admin_record_whatsapp_consent('0755 000 008', 'Withdraw Person', null, 'whatsapp_reply', 'service', null, null, rep);
  m4 := admin_propose_sales_whatsapp(c_w, 'service', 'Hello, a note about your demo.', rep);
  v := pg_temp.err(format('select admin_withdraw_whatsapp_consent(%L, null)', c_w));
  if v <> 'Say who is withdrawing this agreement.' then raise exception 'FAIL 12a: got %', v; end if;
  perform admin_withdraw_whatsapp_consent(c_w, rep2, 'asked us to stop');
  perform admin_withdraw_whatsapp_consent(c_w, rep2, 'asked us to stop');   -- idempotent
  perform pg_temp.as_owner();
  select count(*) into n from whatsapp_consents where id = c_w and withdrawn_at is not null and withdrawn_by = rep2;
  if n <> 1 then raise exception 'FAIL 12b: agreement not marked withdrawn'; end if;
  select status into s from sales_whatsapp_messages where id = m4;
  if s <> 'cancelled' then raise exception 'FAIL 12c: open message not cancelled (%)', s; end if;
  select count(*) into n from prospect_channel_opt_outs where channel = 'whatsapp' and identifier = '254755000008' and note = 'asked us to stop';
  if n <> 1 then raise exception 'FAIL 12d: opt-out not recorded exactly once (%)', n; end if;
  perform pg_temp.as_user(staff);
  v := pg_temp.err(format('select admin_propose_sales_whatsapp(%L, ''service'', %L, %L)', c_w, 'Hello again', rep));
  if v <> 'This person withdrew their agreement to WhatsApp messages.' then raise exception 'FAIL 12e: got %', v; end if;
  v := pg_temp.err(format('select admin_record_whatsapp_consent(''0755000008'', ''Back Again'', null, ''call'', ''service'', null, null, %L)', rep));
  if v not like 'This number has opted out of WhatsApp messages and cannot be added again.%' then raise exception 'FAIL 12f: got %', v; end if;
  perform pg_temp.as_service();
  if record_demo_whatsapp_consent(demo_id, 'Back Again', 'Y', '0755000008', 'words') is not null then raise exception 'FAIL 12g: a withdrawn number was re-added via the demo form'; end if;

  -- ---------- 13. access control ----------
  perform pg_temp.as_user(nobody);
  v := pg_temp.err(format('select admin_propose_sales_whatsapp(%L, ''service'', ''Hello'', %L)', c_a, rep));
  if v <> 'Not authorized to manage WhatsApp messages.' then raise exception 'FAIL 13a: got %', v; end if;
  v := pg_temp.err(format('select admin_review_sales_whatsapp(%L, ''reject'', null, %L)', m4, rep));
  if v <> 'Not authorized to manage WhatsApp messages.' then raise exception 'FAIL 13b: got %', v; end if;
  v := pg_temp.err(format('select admin_mark_sales_whatsapp_sent(%L, %L)', m4, rep));
  if v <> 'Not authorized to manage WhatsApp messages.' then raise exception 'FAIL 13c: got %', v; end if;
  v := pg_temp.err(format('select admin_edit_sales_whatsapp(%L, ''x'')', m4));
  if v <> 'Not authorized to manage WhatsApp messages.' then raise exception 'FAIL 13d: got %', v; end if;
  v := pg_temp.err(format('select admin_withdraw_sales_whatsapp(%L)', m4));
  if v <> 'Not authorized to manage WhatsApp messages.' then raise exception 'FAIL 13e: got %', v; end if;
  v := pg_temp.err(format('select admin_record_whatsapp_consent(''0766000009'', ''N'', null, ''call'', ''service'', null, null, %L)', rep));
  if v <> 'Not authorized to manage WhatsApp messages.' then raise exception 'FAIL 13f: got %', v; end if;
  v := pg_temp.err(format('select admin_withdraw_whatsapp_consent(%L, %L)', c_a, rep));
  if v <> 'Not authorized to manage WhatsApp messages.' then raise exception 'FAIL 13g: got %', v; end if;
  v := pg_temp.err('select * from admin_get_sales_whatsapp_settings()');
  if v <> 'Not authorized to manage WhatsApp messages.' then raise exception 'FAIL 13h: got %', v; end if;
  v := pg_temp.err(format('select admin_set_sales_whatsapp_settings(true, %L)', rep));
  if v <> 'Not authorized to manage WhatsApp messages.' then raise exception 'FAIL 13i: a non-admin changed the switch: %', v; end if;
  select count(*) into n from whatsapp_consents;
  if n <> 0 then raise exception 'FAIL 13j: non-admin can read agreements (%)', n; end if;
  select count(*) into n from sales_whatsapp_messages;
  if n <> 0 then raise exception 'FAIL 13k: non-admin can read messages (%)', n; end if;
  select count(*) into n from sales_whatsapp_settings;
  if n <> 0 then raise exception 'FAIL 13l: non-admin can read settings (%)', n; end if;

  perform pg_temp.as_anon();
  v := pg_temp.err(format('select admin_mark_sales_whatsapp_sent(%L, %L)', m4, rep));
  if v = '' then raise exception 'FAIL 13m: anon could mark a message sent'; end if;

  perform pg_temp.as_user(staff);
  select count(*) into n from whatsapp_consents;
  if n < 5 then raise exception 'FAIL 13n: super admin sees % agreements', n; end if;
  v := pg_temp.err('insert into whatsapp_consents (phone, contact_name, source, consent_text) values (''254700099999'', ''X'', ''demo_form'', ''words'')');
  if v = '' then raise exception 'FAIL 13o: direct insert into agreements allowed'; end if;
  v := pg_temp.err('update whatsapp_consents set withdrawn_at = null');
  if v = '' then raise exception 'FAIL 13p: direct update of agreements allowed'; end if;
  v := pg_temp.err('delete from whatsapp_consents');
  if v = '' then raise exception 'FAIL 13q: direct delete of agreements allowed'; end if;
  v := pg_temp.err('update sales_whatsapp_messages set status = ''approved''');
  if v = '' then raise exception 'FAIL 13r: direct update of messages allowed'; end if;
  v := pg_temp.err('update sales_whatsapp_settings set promotional_enabled = true');
  if v = '' then raise exception 'FAIL 13s: direct settings update allowed'; end if;

  perform pg_temp.as_owner();
  if has_table_privilege('authenticated', 'public.whatsapp_consents', 'insert') or has_table_privilege('authenticated', 'public.whatsapp_consents', 'update')
     or has_table_privilege('authenticated', 'public.whatsapp_consents', 'delete') or has_table_privilege('authenticated', 'public.whatsapp_consents', 'truncate') then
    raise exception 'FAIL 13t: authenticated holds a write privilege on whatsapp_consents';
  end if;
  if has_table_privilege('authenticated', 'public.sales_whatsapp_messages', 'insert') or has_table_privilege('authenticated', 'public.sales_whatsapp_messages', 'update')
     or has_table_privilege('authenticated', 'public.sales_whatsapp_messages', 'delete') or has_table_privilege('authenticated', 'public.sales_whatsapp_messages', 'truncate') then
    raise exception 'FAIL 13u: authenticated holds a write privilege on sales_whatsapp_messages';
  end if;
  if has_table_privilege('authenticated', 'public.sales_whatsapp_settings', 'insert') or has_table_privilege('authenticated', 'public.sales_whatsapp_settings', 'update')
     or has_table_privilege('authenticated', 'public.sales_whatsapp_settings', 'delete') then
    raise exception 'FAIL 13v: authenticated holds a write privilege on sales_whatsapp_settings';
  end if;
  if has_table_privilege('anon', 'public.whatsapp_consents', 'select') or has_table_privilege('anon', 'public.sales_whatsapp_messages', 'select')
     or has_table_privilege('anon', 'public.sales_whatsapp_settings', 'select') then
    raise exception 'FAIL 13w: anon can read a WhatsApp table';
  end if;
  if has_function_privilege('anon', 'public.admin_mark_sales_whatsapp_sent(uuid,uuid)', 'execute')
     or has_function_privilege('anon', 'public.admin_review_sales_whatsapp(uuid,text,text,uuid,text)', 'execute')
     or has_function_privilege('anon', 'public.admin_record_whatsapp_consent(text,text,text,text,text,text,uuid,uuid)', 'execute')
     or has_function_privilege('anon', 'public.admin_withdraw_whatsapp_consent(uuid,uuid,text)', 'execute') then
    raise exception 'FAIL 13x: anon can execute a WhatsApp admin function';
  end if;
  if has_function_privilege('authenticated', 'public.record_demo_whatsapp_consent(uuid,text,text,text,text)', 'execute')
     or has_function_privilege('anon', 'public.record_demo_whatsapp_consent(uuid,text,text,text,text)', 'execute') then
    raise exception 'FAIL 13y: a client role can execute the public-path function';
  end if;
  if not has_function_privilege('service_role', 'public.record_demo_whatsapp_consent(uuid,text,text,text,text)', 'execute') then
    raise exception 'FAIL 13z: service_role cannot execute the public-path function';
  end if;
  if has_function_privilege('authenticated', 'public._sales_wa_problem(uuid,text,uuid)', 'execute')
     or has_function_privilege('authenticated', 'public._sales_wa_content_problem(text,text)', 'execute')
     or has_function_privilege('authenticated', 'public._sales_wa_hash(uuid,text,text,text)', 'execute') then
    raise exception 'FAIL 13za: authenticated can execute an internal helper';
  end if;

  -- ---------- 14. cleanup behaviour ----------
  delete from platform_team_members where id = rep;
  select count(*) into n from sales_whatsapp_messages where consent_id = c_a and proposed_by is null;
  if n <> 1 then raise exception 'FAIL 14a: removing a team member should keep the message and clear the name (%)', n; end if;
  delete from whatsapp_consents where id = c_a;
  select count(*) into n from sales_whatsapp_messages where consent_id = c_a;
  if n <> 0 then raise exception 'FAIL 14b: deleting an agreement left its messages (%)', n; end if;
  delete from marketing_demo_requests where id = demo_id;
  select count(*) into n from whatsapp_consents where demo_request_id = demo_id;
  if n <> 0 then raise exception 'FAIL 14c: a consent still points at a deleted demo request (%)', n; end if;

  raise notice 'sales_whatsapp: all passed';
end $$;

rollback;
