-- Behavioural tests for 20261018220000_trial_nudges.sql.
-- Same safety model as the other supabase/tests files: synthetic fixtures (.invalid addresses), impersonation via
-- request.jwt.claims, everything inside ONE transaction that ends in ROLLBACK, so nothing persists. Nothing is ever
-- sent: the send hand-off only writes campaign rows, and the test plays the Edge Function by updating them itself.
--   psql "$SUPABASE_DB_URL" -v ON_ERROR_STOP=1 -f supabase/tests/trial_nudges.sql
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

-- A school with a subscription and (optionally) an owner.
create or replace function pg_temp.mk(p_slug text, p_school_status text, p_sub_status text, p_ends interval, p_owner_email text)
returns uuid language plpgsql as $$
declare v_id uuid;
begin
  insert into schools (name, slug, status) values ('TN ' || p_slug, p_slug, p_school_status) returning id into v_id;
  insert into school_subscriptions (school_id, status, trial_ends_at) values (v_id, p_sub_status, now() + p_ends);
  if p_owner_email is not null then
    insert into school_users (school_id, auth_user_id, role_id, full_name, email, status)
    values (v_id, gen_random_uuid(), (select id from roles where name = 'school_owner'), 'Owner ' || p_slug, p_owner_email, 'active');
  end if;
  return v_id;
end $$;

do $$
declare
  staff uuid := gen_random_uuid();
  nobody uuid := gen_random_uuid();
  rep uuid := gen_random_uuid();
  rep2 uuid := gen_random_uuid();
  sch_a uuid; sch_b uuid; sch_c uuid; sch_d uuid; sch_e uuid; sch_f uuid; sch_g uuid; sch_h uuid; sch_i uuid;
  sch_p uuid; sch_q uuid; sch_cap uuid;
  n1 uuid; n2 uuid; n3 uuid; n4 uuid; nid uuid;
  hash1 text; hash2 text;
  j jsonb;
  v text;
  n integer;
  s text;
  camp uuid;
  good_subject text := 'Welcome to your EduCore trial, {{school}}';
  good_body text := E'Hello {{name}},\n\nYour 30-day free trial is running. No card required. See https://www.educoreafrica.com/help or reply here.\n\nThe EduCore team';
begin
  -- ---------- fixtures ----------
  insert into auth.users (id, aud, role, email) values
    (staff, 'authenticated', 'authenticated', 'tn-staff@example.invalid'),
    (nobody, 'authenticated', 'authenticated', 'tn-nobody@example.invalid');
  insert into school_users (school_id, auth_user_id, role_id, full_name, email) values
    (null, staff, (select id from roles where name = 'super_admin'), 'TN Staff', 'tn-staff@example.invalid'),
    (null, nobody, (select id from roles where name = 'principal'), 'TN Nobody', 'tn-nobody@example.invalid');
  insert into platform_team_members (id, name, email) values (rep, 'TN Rep', 'tn-rep@example.invalid'), (rep2, 'TN Rep Two', 'tn-rep2@example.invalid');

  sch_a := pg_temp.mk('tn-a-running', 'trial', 'trialing', interval '20 days', 'Owner.A@Example.Invalid');
  sch_b := pg_temp.mk('tn-b-noowner', 'trial', 'trialing', interval '20 days', null);
  sch_c := pg_temp.mk('tn-c-ended3', 'suspended', 'past_due', interval '-3 days', 'owner.c@example.invalid');
  sch_d := pg_temp.mk('demo-academy', 'trial', 'trialing', interval '20 days', 'owner.d@example.invalid');
  sch_e := pg_temp.mk('tn-e-unsub', 'trial', 'trialing', interval '20 days', 'owner.e@example.invalid');
  sch_f := pg_temp.mk('tn-f-stop', 'trial', 'trialing', interval '20 days', 'owner.f@example.invalid');
  sch_g := pg_temp.mk('tn-g-notint', 'trial', 'trialing', interval '20 days', 'owner.g@example.invalid');
  sch_h := pg_temp.mk('tn-h-ended20', 'suspended', 'suspended', interval '-20 days', 'owner.h@example.invalid');
  sch_i := pg_temp.mk('tn-i-paying', 'active', 'active', interval '0 days', 'owner.i@example.invalid');
  sch_p := pg_temp.mk('tn-p-promo', 'trial', 'trialing', interval '20 days', 'owner.p@example.invalid');
  sch_q := pg_temp.mk('tn-q-second', 'trial', 'trialing', interval '20 days', 'owner.q@example.invalid');
  sch_cap := pg_temp.mk('tn-cap-bulk', 'trial', 'trialing', interval '20 days', 'owner.cap@example.invalid');
  insert into marketing_email_suppressions (email, reason) values ('owner.e@example.invalid', 'unsubscribed');
  insert into trial_checkins (school_id, channel, outcome) values (sch_f, 'call', 'asked_to_stop'), (sch_g, 'call', 'reached_not_interested');

  -- ---------- 0. switches default OFF ----------
  perform pg_temp.as_user(staff);
  if (select sending_enabled or promotional_enabled from admin_get_trial_nudge_settings()) then
    raise exception 'FAIL 0a: a switch is on by default';
  end if;

  -- ---------- 1. content rules ----------
  v := pg_temp.err(format('select admin_propose_trial_nudge(%L, ''service'', %L, %L, %L)', sch_a, 'Hi', 'We offer no obligation to continue.', rep));
  if v not like 'Remove "no obligation"%' then raise exception 'FAIL 1a: got %', v; end if;
  v := pg_temp.err(format('select admin_propose_trial_nudge(%L, ''service'', %L, %L, %L)', sch_a, 'Hi', 'EduCore is KICD approved.', rep));
  if v not like 'Remove "kicd approved"%' then raise exception 'FAIL 1b: got %', v; end if;
  v := pg_temp.err(format('select admin_propose_trial_nudge(%L, ''service'', %L, %L, %L)', sch_a, 'Hi', 'Hello {{foo}}', rep));
  if v <> 'Only {{name}} and {{school}} can be used as placeholders.' then raise exception 'FAIL 1c: got %', v; end if;
  v := pg_temp.err(format('select admin_propose_trial_nudge(%L, ''service'', %L, %L, %L)', sch_a, 'Hi', 'Pay at https://bit.ly/x1', rep));
  if v not like 'Links and addresses may only point to educoreafrica.com%' then raise exception 'FAIL 1d: got %', v; end if;
  v := pg_temp.err(format('select admin_propose_trial_nudge(%L, ''service'', %L, %L, %L)', sch_a, 'Hi', 'Visit evil-school.co.ke now', rep));
  if v not like 'Links and addresses may only point to educoreafrica.com%' then raise exception 'FAIL 1e: got %', v; end if;
  v := pg_temp.err(format('select admin_propose_trial_nudge(%L, ''service'', %L, %L, %L)', sch_a, 'Hi', 'Get a discount today', rep));
  if v <> 'This reads like an offer. Send it as a promotional message instead.' then raise exception 'FAIL 1f: got %', v; end if;
  v := pg_temp.err(format('select admin_propose_trial_nudge(%L, ''service'', %L, %L, %L)', sch_a, 'Hi', '   ', rep));
  if v <> 'Message is required.' then raise exception 'FAIL 1g: got %', v; end if;
  v := pg_temp.err(format('select admin_propose_trial_nudge(%L, ''service'', %L, %L, %L)', sch_a, 'Hi', repeat('x', 4001), rep));
  if v not like 'Message is too long%' then raise exception 'FAIL 1h: got %', v; end if;
  v := pg_temp.err(format('select admin_propose_trial_nudge(%L, ''banner'', %L, %L, %L)', sch_a, 'Hi', 'Body', rep));
  if v <> 'Choose service or promotional.' then raise exception 'FAIL 1i: got %', v; end if;
  v := pg_temp.err(format('select admin_propose_trial_nudge(%L, ''service'', %L, %L, null)', sch_a, 'Hi', 'Body'));
  if v <> 'Say who is proposing this message.' then raise exception 'FAIL 1j: got %', v; end if;
  v := pg_temp.err(format('select admin_propose_trial_nudge(%L, ''promotional'', %L, %L, %L)', sch_a, 'Hi', 'Get a discount on https://www.educoreafrica.com/pricing', rep));
  if v <> '' then raise exception 'FAIL 1k: a promotional offer with an allowed link was refused: %', v; end if;
  perform admin_withdraw_trial_nudge((select id from trial_nudges where school_id = sch_a and status = 'proposed'));

  -- ---------- 2. who can be messaged ----------
  v := pg_temp.err(format('select admin_propose_trial_nudge(%L, ''service'', %L, %L, %L)', gen_random_uuid(), 'Hi', 'Body', rep));
  if v <> 'School not found.' then raise exception 'FAIL 2a: got %', v; end if;
  v := pg_temp.err(format('select admin_propose_trial_nudge(%L, ''service'', %L, %L, %L)', sch_b, 'Hi', 'Body', rep));
  if v <> 'This school has no active owner email on file.' then raise exception 'FAIL 2b: got %', v; end if;
  v := pg_temp.err(format('select admin_propose_trial_nudge(%L, ''service'', %L, %L, %L)', sch_d, 'Hi', 'Body', rep));
  if v <> 'Demo and test schools are never messaged.' then raise exception 'FAIL 2c: got %', v; end if;
  v := pg_temp.err(format('select admin_propose_trial_nudge(%L, ''service'', %L, %L, %L)', sch_e, 'Hi', 'Body', rep));
  if v <> 'This address has unsubscribed from EduCore email.' then raise exception 'FAIL 2d: got %', v; end if;
  v := pg_temp.err(format('select admin_propose_trial_nudge(%L, ''service'', %L, %L, %L)', sch_f, 'Hi', 'Body', rep));
  if v <> 'This school asked not to be contacted.' then raise exception 'FAIL 2e: got %', v; end if;
  v := pg_temp.err(format('select admin_propose_trial_nudge(%L, ''promotional'', %L, %L, %L)', sch_f, 'Hi', 'Body', rep));
  if v <> 'This school asked not to be contacted.' then raise exception 'FAIL 2f: got %', v; end if;
  v := pg_temp.err(format('select admin_propose_trial_nudge(%L, ''promotional'', %L, %L, %L)', sch_g, 'Hi', 'Body', rep));
  if v not like 'This school said it is not interested%' then raise exception 'FAIL 2g: got %', v; end if;
  v := pg_temp.err(format('select admin_propose_trial_nudge(%L, ''service'', %L, %L, %L)', sch_c, 'Hi', 'Body', rep));
  if v <> 'Service messages are only for trials that are running.' then raise exception 'FAIL 2h: got %', v; end if;
  v := pg_temp.err(format('select admin_propose_trial_nudge(%L, ''promotional'', %L, %L, %L)', sch_h, 'Hi', 'Body', rep));
  if v not like 'Promotional messages are only for running trials or trials that ended%' then raise exception 'FAIL 2i: got %', v; end if;
  v := pg_temp.err(format('select admin_propose_trial_nudge(%L, ''promotional'', %L, %L, %L)', sch_i, 'Hi', 'Body', rep));
  if v not like 'Promotional messages are only for running trials%' then raise exception 'FAIL 2j: paying school got %', v; end if;
  -- allowed: service to a school that said "not interested"; promotional to a recently ended trial
  v := pg_temp.err(format('select admin_propose_trial_nudge(%L, ''service'', %L, %L, %L)', sch_g, 'Hi', 'Body', rep));
  if v <> '' then raise exception 'FAIL 2k: service to not-interested school refused: %', v; end if;
  v := pg_temp.err(format('select admin_propose_trial_nudge(%L, ''promotional'', %L, %L, %L)', sch_c, 'Hi', 'Body', rep));
  if v <> '' then raise exception 'FAIL 2l: win-back promotional refused: %', v; end if;
  perform admin_withdraw_trial_nudge(id) from trial_nudges where school_id in (sch_g, sch_c);

  -- ---------- 3. proposing, one open message per school, editing ----------
  n1 := admin_propose_trial_nudge(sch_a, 'service', good_subject, good_body, rep);
  perform pg_temp.as_owner();
  select count(*) into n from trial_nudges
   where id = n1 and school_id = sch_a and status = 'proposed' and recipient_email = 'owner.a@example.invalid'
     and recipient_name = 'Owner tn-a-running' and proposed_by = rep and payload_hash ~ '^[0-9a-f]{64}$';
  if n <> 1 then raise exception 'FAIL 3a: proposal row not stored as expected'; end if;
  select payload_hash into hash1 from trial_nudges where id = n1;

  perform pg_temp.as_user(staff);
  v := pg_temp.err(format('select admin_propose_trial_nudge(%L, ''service'', %L, %L, %L)', sch_a, 'Hi again', 'Body', rep));
  if v <> 'This school already has a message waiting to be reviewed or sent.' then raise exception 'FAIL 3b: got %', v; end if;

  perform admin_edit_trial_nudge(n1, 'Welcome, {{school}}', good_body);
  select payload_hash into hash2 from trial_nudges where id = n1;
  if hash2 = hash1 then raise exception 'FAIL 3c: editing did not change the hash'; end if;
  v := pg_temp.err(format('select admin_edit_trial_nudge(%L, %L, %L)', n1, 'Hi', 'We offer no obligation'));
  if v not like 'Remove "no obligation"%' then raise exception 'FAIL 3d: edit skipped content rules: %', v; end if;

  -- ---------- 4. approval is bound to the exact text ----------
  v := pg_temp.err(format('select admin_review_trial_nudge(%L, ''approve'', %L, %L)', n1, hash1, rep2));
  if v <> 'This message changed since you opened it. Reload and review it again.' then raise exception 'FAIL 4a: stale hash got %', v; end if;
  v := pg_temp.err(format('select admin_review_trial_nudge(%L, ''approve'', %L, null)', n1, hash2));
  if v <> 'Say who is reviewing this message.' then raise exception 'FAIL 4b: got %', v; end if;
  v := pg_temp.err(format('select admin_review_trial_nudge(%L, ''maybe'', %L, %L)', n1, hash2, rep2));
  if v <> 'Decision must be approve or reject.' then raise exception 'FAIL 4c: got %', v; end if;
  s := admin_review_trial_nudge(n1, 'approve', hash2, rep2, '  looks right  ');
  if s <> 'approved' then raise exception 'FAIL 4d: got %', s; end if;
  perform pg_temp.as_owner();
  select count(*) into n from trial_nudges where id = n1 and status = 'approved' and approved_hash = payload_hash and reviewed_by = rep2 and review_note = 'looks right';
  if n <> 1 then raise exception 'FAIL 4e: approval not recorded as expected'; end if;
  perform pg_temp.as_user(staff);
  s := admin_review_trial_nudge(n1, 'approve', hash2, rep2);   -- repeat: no-op
  if s <> 'approved' then raise exception 'FAIL 4f: repeat approve got %', s; end if;
  v := pg_temp.err(format('select admin_review_trial_nudge(%L, ''reject'', null, %L)', n1, rep2));
  if v <> 'This message is already approved.' then raise exception 'FAIL 4g: reject after approve got %', v; end if;
  v := pg_temp.err(format('select admin_edit_trial_nudge(%L, ''Sneaky'', ''Changed after approval'')', n1));
  if v not like 'Only a message that has not been approved can be edited%' then raise exception 'FAIL 4h: approved text was editable: %', v; end if;

  -- ---------- 5. sending is gated by the switches ----------
  j := admin_queue_trial_nudge(n1);
  if (j->>'ok')::boolean or j->>'message' <> 'Sending trial messages is switched off.' then raise exception 'FAIL 5a: got %', j; end if;
  perform admin_set_trial_nudge_settings(true, false, rep);
  v := pg_temp.err(format('select admin_set_trial_nudge_settings(true, false, null)'));
  if v <> 'Say who you are before changing these switches.' then raise exception 'FAIL 5b: got %', v; end if;

  -- ---------- 6. tampering and drift are refused at send time ----------
  perform pg_temp.as_owner();
  update trial_nudges set body = body || ' PS: pay now' where id = n1;      -- out-of-band edit of approved text
  perform pg_temp.as_user(staff);
  j := admin_queue_trial_nudge(n1);
  if (j->>'ok')::boolean or j->>'message' <> 'The message no longer matches what was approved.' then raise exception 'FAIL 6a: got %', j; end if;
  perform pg_temp.as_owner();
  update trial_nudges set body = good_body where id = n1;
  update school_users set email = 'new.owner.a@example.invalid' where school_id = sch_a;   -- owner address changed after approval
  perform pg_temp.as_user(staff);
  j := admin_queue_trial_nudge(n1);
  if (j->>'ok')::boolean or j->>'message' not like 'The recipient changed since approval%' then raise exception 'FAIL 6b: got %', j; end if;
  perform pg_temp.as_owner();
  update school_users set email = 'Owner.A@Example.Invalid' where school_id = sch_a;
  insert into marketing_email_suppressions (email, reason) values ('owner.a@example.invalid', 'unsubscribed');   -- unsubscribed after approval
  perform pg_temp.as_user(staff);
  j := admin_queue_trial_nudge(n1);
  if (j->>'ok')::boolean or j->>'message' <> 'This address has unsubscribed from EduCore email.' then raise exception 'FAIL 6c: got %', j; end if;
  perform pg_temp.as_owner();
  delete from marketing_email_suppressions where email = 'owner.a@example.invalid';
  insert into trial_checkins (school_id, channel, outcome) values (sch_a, 'call', 'asked_to_stop');   -- asked to stop after approval
  perform pg_temp.as_user(staff);
  j := admin_queue_trial_nudge(n1);
  if (j->>'ok')::boolean or j->>'message' <> 'This school asked not to be contacted.' then raise exception 'FAIL 6d: got %', j; end if;
  perform pg_temp.as_owner();
  delete from trial_checkins where school_id = sch_a;
  perform pg_temp.as_user(staff);

  -- ---------- 7. the hand-off to the campaign pipeline ----------
  j := admin_queue_trial_nudge(n1);
  if not (j->>'ok')::boolean then raise exception 'FAIL 7a: queue refused: %', j; end if;
  camp := (j->>'campaign_id')::uuid;
  perform pg_temp.as_owner();
  select count(*) into n from email_campaigns where id = camp and audience = 'school_owners';
  if n <> 1 then raise exception 'FAIL 7b: campaign not created as school_owners'; end if;
  select count(*) into n from email_campaign_recipients r, trial_nudges t
   where r.campaign_id = camp and t.id = n1 and r.email = t.recipient_email and r.custom_subject = t.subject
     and r.custom_body = t.body and r.school_id = sch_a and r.status = 'queued';
  if n <> 1 then raise exception 'FAIL 7c: recipient does not carry the approved text'; end if;
  select count(*) into n from email_campaign_recipients where campaign_id = camp;
  if n <> 1 then raise exception 'FAIL 7d: campaign should have exactly one recipient (%)', n; end if;
  select count(*) into n from trial_nudges where id = n1 and status = 'queued' and campaign_id = camp and queued_at is not null;
  if n <> 1 then raise exception 'FAIL 7e: nudge not marked queued'; end if;
  perform pg_temp.as_user(staff);
  j := admin_queue_trial_nudge(n1);   -- idempotent: no second campaign
  if (j->>'campaign_id')::uuid <> camp or not coalesce((j->>'already_queued')::boolean, false) then raise exception 'FAIL 7f: got %', j; end if;
  perform pg_temp.as_owner();
  select count(*) into n from email_campaigns where subject like 'Trial message:%';
  if n <> 1 then raise exception 'FAIL 7g: repeat queue created another campaign (%)', n; end if;

  -- ---------- 8. reading the result back (the test plays the Edge Function) ----------
  perform pg_temp.as_user(staff);
  s := admin_finalize_trial_nudge(n1);
  if s <> 'queued' then raise exception 'FAIL 8a: unsent finalize got %', s; end if;
  perform pg_temp.as_owner();
  update email_campaign_recipients set status = 'sent', sent_at = now() where campaign_id = camp;
  perform pg_temp.as_user(staff);
  s := admin_finalize_trial_nudge(n1);
  if s <> 'sent' then raise exception 'FAIL 8b: got %', s; end if;
  s := admin_finalize_trial_nudge(n1);   -- idempotent
  if s <> 'sent' then raise exception 'FAIL 8c: got %', s; end if;
  perform pg_temp.as_owner();
  select count(*) into n from trial_checkins where school_id = sch_a and channel = 'email' and outcome = 'message_left' and note = 'Trial message emailed (service)';
  if n <> 1 then raise exception 'FAIL 8d: email check-in not recorded exactly once (%)', n; end if;
  select count(*) into n from trial_nudges where id = n1 and status = 'sent' and sent_at is not null;
  if n <> 1 then raise exception 'FAIL 8e: nudge not marked sent'; end if;

  -- ---------- 9. frequency caps ----------
  perform pg_temp.as_user(staff);
  v := pg_temp.err(format('select admin_propose_trial_nudge(%L, ''service'', %L, %L, %L)', sch_a, 'Again', 'Body', rep));
  if v <> 'This school was messaged, or has an approved message waiting, in the last 3 days.' then raise exception 'FAIL 9a: got %', v; end if;
  -- two promotional messages already sent (10 and 20 days ago): a third is refused even though the 3-day gap is clear
  perform pg_temp.as_owner();
  insert into trial_nudges (school_id, kind, recipient_email, subject, body, payload_hash, status, approved_hash, sent_at, created_at)
  select sch_p, 'promotional', 'owner.p@example.invalid', 'Old ' || d, 'Old body', 'h' || d, 'sent', 'h' || d, now() - (d || ' days')::interval, now() - (d || ' days')::interval
  from unnest(array[10, 20]) as d;
  perform pg_temp.as_user(staff);
  v := pg_temp.err(format('select admin_propose_trial_nudge(%L, ''promotional'', %L, %L, %L)', sch_p, 'Third', 'Body', rep));
  if v <> 'This school already has 2 promotional messages in the last 30 days.' then raise exception 'FAIL 9b: got %', v; end if;
  v := pg_temp.err(format('select admin_propose_trial_nudge(%L, ''service'', %L, %L, %L)', sch_p, 'Service ok', 'Body', rep));
  if v <> '' then raise exception 'FAIL 9c: the promotional cap blocked a service message: %', v; end if;
  perform admin_withdraw_trial_nudge((select id from trial_nudges where school_id = sch_p and status = 'proposed'));

  -- ---------- 10. expiry ----------
  n2 := admin_propose_trial_nudge(sch_q, 'service', good_subject, good_body, rep);
  select payload_hash into hash1 from trial_nudges where id = n2;
  perform pg_temp.as_owner();
  update trial_nudges set created_at = now() - interval '8 days' where id = n2;
  perform pg_temp.as_user(staff);
  s := admin_review_trial_nudge(n2, 'approve', hash1, rep);
  if s <> 'expired' then raise exception 'FAIL 10a: old proposal got %', s; end if;
  perform pg_temp.as_owner();
  select status into s from trial_nudges where id = n2;
  if s <> 'expired' then raise exception 'FAIL 10b: expiry not recorded (%)', s; end if;
  perform pg_temp.as_user(staff);
  n2 := admin_propose_trial_nudge(sch_q, 'service', good_subject, good_body, rep);
  select payload_hash into hash1 from trial_nudges where id = n2;
  perform admin_review_trial_nudge(n2, 'approve', hash1, rep);
  perform pg_temp.as_owner();
  update trial_nudges set reviewed_at = now() - interval '25 hours' where id = n2;
  perform pg_temp.as_user(staff);
  j := admin_queue_trial_nudge(n2);
  if (j->>'ok')::boolean or j->>'message' not like 'The approval expired after 24 hours%' then raise exception 'FAIL 10c: got %', j; end if;
  perform pg_temp.as_owner();
  select status into s from trial_nudges where id = n2;
  if s <> 'expired' then raise exception 'FAIL 10d: lapsed approval not recorded (%)', s; end if;

  -- ---------- 11. promotional has its own switch ----------
  perform pg_temp.as_user(staff);
  n3 := admin_propose_trial_nudge(sch_c, 'promotional', 'Win-back', 'Hello {{name}}, we would like to hear how we can help.', rep);
  select payload_hash into hash1 from trial_nudges where id = n3;
  perform admin_review_trial_nudge(n3, 'approve', hash1, rep2);
  j := admin_queue_trial_nudge(n3);
  if (j->>'ok')::boolean or j->>'message' <> 'Promotional trial messages are switched off.' then raise exception 'FAIL 11a: got %', j; end if;
  perform admin_set_trial_nudge_settings(true, true, rep);
  j := admin_queue_trial_nudge(n3);
  if not (j->>'ok')::boolean then raise exception 'FAIL 11b: promotional refused with both switches on: %', j; end if;
  -- failure and unsubscribe-before-send are recorded as failed, not sent
  perform pg_temp.as_owner();
  update email_campaign_recipients set status = 'skipped_unsubscribed' where campaign_id = (j->>'campaign_id')::uuid;
  perform pg_temp.as_user(staff);
  s := admin_finalize_trial_nudge(n3);
  if s <> 'failed' then raise exception 'FAIL 11c: got %', s; end if;
  perform pg_temp.as_owner();
  select count(*) into n from trial_nudges where id = n3 and error = 'The owner unsubscribed before this was sent.';
  if n <> 1 then raise exception 'FAIL 11d: failure reason missing'; end if;
  select count(*) into n from trial_checkins where school_id = sch_c;
  if n <> 0 then raise exception 'FAIL 11e: a failed send recorded a check-in'; end if;

  -- ---------- 12. platform-wide daily limit ----------
  perform pg_temp.as_owner();
  insert into trial_nudges (school_id, kind, recipient_email, subject, body, payload_hash, status, approved_hash, sent_at)
  select sch_cap, 'service', 'owner.cap@example.invalid', 'Bulk ' || g, 'Bulk', 'b' || g, 'sent', 'b' || g, now() - interval '1 hour'
  from generate_series(1, 30) g;
  perform pg_temp.as_user(staff);
  n4 := admin_propose_trial_nudge(sch_q, 'service', good_subject, good_body, rep);
  select payload_hash into hash1 from trial_nudges where id = n4;
  perform admin_review_trial_nudge(n4, 'approve', hash1, rep);
  j := admin_queue_trial_nudge(n4);
  if (j->>'ok')::boolean or j->>'message' not like 'Daily limit reached%' then raise exception 'FAIL 12a: got %', j; end if;

  -- ---------- 13. withdraw ----------
  perform admin_withdraw_trial_nudge(n4);
  perform admin_withdraw_trial_nudge(n4);   -- repeat: no-op
  v := pg_temp.err(format('select admin_withdraw_trial_nudge(%L)', n1));
  if v <> 'A message that is already sent cannot be withdrawn.' then raise exception 'FAIL 13a: got %', v; end if;
  v := pg_temp.err(format('select admin_withdraw_trial_nudge(%L)', gen_random_uuid()));
  if v <> 'Message not found.' then raise exception 'FAIL 13b: got %', v; end if;
  j := admin_queue_trial_nudge(n4);
  if (j->>'ok')::boolean then raise exception 'FAIL 13c: a withdrawn message was queued'; end if;

  -- ---------- 14. access control ----------
  perform pg_temp.as_user(nobody);
  v := pg_temp.err(format('select admin_propose_trial_nudge(%L, ''service'', ''Hi'', ''Body'', %L)', sch_q, rep));
  if v <> 'Not authorized to manage trial messages.' then raise exception 'FAIL 14a: got %', v; end if;
  v := pg_temp.err(format('select admin_review_trial_nudge(%L, ''reject'', null, %L)', n4, rep));
  if v <> 'Not authorized to manage trial messages.' then raise exception 'FAIL 14b: got %', v; end if;
  v := pg_temp.err(format('select admin_queue_trial_nudge(%L)', n4));
  if v <> 'Not authorized to manage trial messages.' then raise exception 'FAIL 14c: got %', v; end if;
  v := pg_temp.err(format('select admin_finalize_trial_nudge(%L)', n4));
  if v <> 'Not authorized to manage trial messages.' then raise exception 'FAIL 14d: got %', v; end if;
  v := pg_temp.err(format('select admin_edit_trial_nudge(%L, ''a'', ''b'')', n4));
  if v <> 'Not authorized to manage trial messages.' then raise exception 'FAIL 14e: got %', v; end if;
  v := pg_temp.err(format('select admin_withdraw_trial_nudge(%L)', n4));
  if v <> 'Not authorized to manage trial messages.' then raise exception 'FAIL 14f: got %', v; end if;
  v := pg_temp.err('select * from admin_get_trial_nudge_settings()');
  if v <> 'Not authorized to manage trial messages.' then raise exception 'FAIL 14g: got %', v; end if;
  v := pg_temp.err(format('select admin_set_trial_nudge_settings(true, true, %L)', rep));
  if v <> 'Not authorized to manage trial messages.' then raise exception 'FAIL 14h: non-admin changed the switches: %', v; end if;
  select count(*) into n from trial_nudges;
  if n <> 0 then raise exception 'FAIL 14i: non-admin can read the queue (%)', n; end if;
  select count(*) into n from trial_nudge_settings;
  if n <> 0 then raise exception 'FAIL 14j: non-admin can read the settings (%)', n; end if;

  perform pg_temp.as_anon();
  v := pg_temp.err(format('select admin_queue_trial_nudge(%L)', n4));
  if v = '' then raise exception 'FAIL 14k: anon could queue a message'; end if;

  perform pg_temp.as_user(staff);
  select count(*) into n from trial_nudges;
  if n < 5 then raise exception 'FAIL 14l: super admin sees % rows', n; end if;
  v := pg_temp.err(format('insert into trial_nudges (school_id, kind, recipient_email, subject, body, payload_hash) values (%L, ''service'', ''x@example.invalid'', ''s'', ''b'', ''h'')', sch_q));
  if v = '' then raise exception 'FAIL 14m: direct insert allowed'; end if;
  v := pg_temp.err('update trial_nudges set status = ''approved''');
  if v = '' then raise exception 'FAIL 14n: direct update allowed'; end if;
  v := pg_temp.err('update trial_nudge_settings set sending_enabled = true');
  if v = '' then raise exception 'FAIL 14o: direct settings update allowed'; end if;
  v := pg_temp.err('delete from trial_nudges');
  if v = '' then raise exception 'FAIL 14p: direct delete allowed'; end if;

  perform pg_temp.as_owner();
  if has_table_privilege('authenticated', 'public.trial_nudges', 'insert') or has_table_privilege('authenticated', 'public.trial_nudges', 'update')
     or has_table_privilege('authenticated', 'public.trial_nudges', 'delete') or has_table_privilege('authenticated', 'public.trial_nudges', 'truncate') then
    raise exception 'FAIL 14q: authenticated holds a write privilege on trial_nudges';
  end if;
  if has_table_privilege('authenticated', 'public.trial_nudge_settings', 'insert') or has_table_privilege('authenticated', 'public.trial_nudge_settings', 'update')
     or has_table_privilege('authenticated', 'public.trial_nudge_settings', 'delete') then
    raise exception 'FAIL 14r: authenticated holds a write privilege on trial_nudge_settings';
  end if;
  if has_table_privilege('anon', 'public.trial_nudges', 'select') or has_table_privilege('anon', 'public.trial_nudge_settings', 'select') then
    raise exception 'FAIL 14s: anon can read the queue or settings';
  end if;
  if not has_table_privilege('authenticated', 'public.trial_nudges', 'select') then
    raise exception 'FAIL 14t: authenticated lost select';
  end if;
  if has_function_privilege('anon', 'public.admin_propose_trial_nudge(uuid,text,text,text,uuid)', 'execute')
     or has_function_privilege('anon', 'public.admin_review_trial_nudge(uuid,text,text,uuid,text)', 'execute')
     or has_function_privilege('anon', 'public.admin_queue_trial_nudge(uuid)', 'execute')
     or has_function_privilege('anon', 'public.admin_finalize_trial_nudge(uuid)', 'execute')
     or has_function_privilege('anon', 'public.admin_set_trial_nudge_settings(boolean,boolean,uuid)', 'execute') then
    raise exception 'FAIL 14u: anon can execute a trial nudge function';
  end if;
  if has_function_privilege('authenticated', 'public._trial_nudge_problem(uuid,text,uuid)', 'execute')
     or has_function_privilege('authenticated', 'public._trial_nudge_content_problem(text,text,text)', 'execute')
     or has_function_privilege('authenticated', 'public._trial_nudge_recipient(uuid)', 'execute')
     or has_function_privilege('authenticated', 'public._trial_nudge_hash(uuid,text,text,text,text)', 'execute') then
    raise exception 'FAIL 14v: authenticated can execute an internal helper';
  end if;

  -- ---------- 15. cleanup behaviour ----------
  delete from platform_team_members where id = rep;
  select count(*) into n from trial_nudges where school_id = sch_a;
  if n < 2 or (select count(*) from trial_nudges where proposed_by is null and school_id = sch_a) <> n then
    raise exception 'FAIL 15a: removing a team member should keep the messages and clear the name (%)', n;
  end if;
  delete from school_users where school_id = sch_a;
  delete from school_subscriptions where school_id = sch_a;
  delete from schools where id = sch_a;
  select count(*) into n from trial_nudges where school_id = sch_a;
  if n <> 0 then raise exception 'FAIL 15b: deleting a school left its messages (%)', n; end if;

  raise notice 'trial_nudges: all passed';
end $$;

rollback;
