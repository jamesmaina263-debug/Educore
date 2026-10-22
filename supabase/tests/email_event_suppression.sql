-- Behavioural tests for 20261022095254_auto_suppress_bounced_and_complained_emails.sql.
-- Same safety model as the other supabase/tests files: synthetic fixtures (.invalid addresses), everything inside
-- ONE transaction that ends in ROLLBACK, so nothing persists. Nothing is ever sent.
--   psql "$SUPABASE_DB_URL" -v ON_ERROR_STOP=1 -f supabase/tests/email_event_suppression.sql
-- Prints "NOTICE: ... all passed" on success and raises on the first failure.

begin;

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

do $$
declare
  ok boolean;
  n integer;
  r text;
  err text := '';
begin
  perform pg_temp.as_owner();

  -- 1. A permanent bounce suppresses the address, with reason 'bounced'.
  ok := record_email_event('t-svix-1', 'email.bounced', now(), 'e1', 'a@educoreafrica.com', 'perm1@esu.invalid', 's', 'Permanent / General', 'no such user');
  if not ok then raise exception 'FAIL 1a: a new event should report true'; end if;
  select reason into r from marketing_email_suppressions where email = 'perm1@esu.invalid';
  if r is distinct from 'bounced' then raise exception 'FAIL 1b: permanent bounce should suppress as bounced (got %)', r; end if;

  -- 2. Transient and undetermined bounces are recorded but do NOT suppress.
  perform record_email_event('t-svix-2', 'email.bounced', now(), 'e2', 'a@educoreafrica.com', 'trans1@esu.invalid', 's', 'Transient / MailboxFull', 'full');
  perform record_email_event('t-svix-3', 'email.bounced', now(), 'e3', 'a@educoreafrica.com', 'undet1@esu.invalid', 's', 'Undetermined / Undetermined', 'unknown');
  perform record_email_event('t-svix-3b', 'email.bounced', now(), 'e3b', 'a@educoreafrica.com', 'nobtype1@esu.invalid', 's', null, null);
  select count(*) into n from marketing_email_suppressions where email in ('trans1@esu.invalid', 'undet1@esu.invalid', 'nobtype1@esu.invalid');
  if n <> 0 then raise exception 'FAIL 2a: non-permanent bounces must not suppress (% rows)', n;
  end if;
  select count(*) into n from email_delivery_events where svix_id in ('t-svix-2', 't-svix-3', 't-svix-3b');
  if n <> 3 then raise exception 'FAIL 2b: non-permanent bounces should still be recorded (% rows)', n; end if;

  -- 3. A spam complaint suppresses with reason 'complained'.
  perform record_email_event('t-svix-4', 'email.complained', now(), 'e4', 'a@educoreafrica.com', 'spam1@esu.invalid', 's', null, null);
  select reason into r from marketing_email_suppressions where email = 'spam1@esu.invalid';
  if r is distinct from 'complained' then raise exception 'FAIL 3: complaint should suppress as complained (got %)', r; end if;

  -- 4. Delivered / delayed / failed events never suppress.
  perform record_email_event('t-svix-5', 'email.delivered', now(), 'e5', 'a@educoreafrica.com', 'ok1@esu.invalid', 's', null, null);
  perform record_email_event('t-svix-6', 'email.delivery_delayed', now(), 'e6', 'a@educoreafrica.com', 'ok2@esu.invalid', 's', null, null);
  perform record_email_event('t-svix-7', 'email.failed', now(), 'e7', 'a@educoreafrica.com', 'ok3@esu.invalid', 's', null, null);
  select count(*) into n from marketing_email_suppressions where email in ('ok1@esu.invalid', 'ok2@esu.invalid', 'ok3@esu.invalid');
  if n <> 0 then raise exception 'FAIL 4: delivered/delayed/failed must not suppress (% rows)', n; end if;

  -- 5. A replayed webhook (same svix id) is a no-op: reports false, still one event, still one suppression.
  ok := record_email_event('t-svix-1', 'email.bounced', now(), 'e1', 'a@educoreafrica.com', 'perm1@esu.invalid', 's', 'Permanent / General', 'no such user');
  if ok then raise exception 'FAIL 5a: a replayed event should report false'; end if;
  select count(*) into n from email_delivery_events where svix_id = 't-svix-1';
  if n <> 1 then raise exception 'FAIL 5b: replay stored % events', n; end if;
  select count(*) into n from marketing_email_suppressions where email = 'perm1@esu.invalid';
  if n <> 1 then raise exception 'FAIL 5c: replay left % suppression rows', n; end if;

  -- 6. An existing suppression is never overwritten: an unsubscribed address stays 'unsubscribed'.
  insert into marketing_email_suppressions (email, reason) values ('unsub1@esu.invalid', 'unsubscribed');
  perform record_email_event('t-svix-8', 'email.bounced', now(), 'e8', 'a@educoreafrica.com', 'unsub1@esu.invalid', 's', 'Permanent / General', 'gone');
  select reason into r from marketing_email_suppressions where email = 'unsub1@esu.invalid';
  if r is distinct from 'unsubscribed' then raise exception 'FAIL 6: existing reason must be kept (got %)', r; end if;

  -- 7. The address is normalised: case and surrounding spaces do not create a second or wrong row.
  perform record_email_event('t-svix-9', 'email.bounced', now(), 'e9', 'a@educoreafrica.com', '  MixedCase1@ESU.invalid ', 's', 'Permanent / Suppressed', 'on list');
  select reason into r from marketing_email_suppressions where email = 'mixedcase1@esu.invalid';
  if r is distinct from 'bounced' then raise exception 'FAIL 7: address should be stored lowercase and trimmed (got %)', r; end if;

  -- 8. A value that is not an email address is skipped, but the event is still recorded.
  perform record_email_event('t-svix-10', 'email.bounced', now(), 'e10', 'a@educoreafrica.com', 'not-an-address', 's', 'Permanent / General', 'x');
  perform record_email_event('t-svix-11', 'email.bounced', now(), 'e11', 'a@educoreafrica.com', null, 's', 'Permanent / General', 'x');
  select count(*) into n from email_delivery_events where svix_id in ('t-svix-10', 't-svix-11');
  if n <> 2 then raise exception 'FAIL 8a: unusable addresses should still record the event (% rows)', n; end if;
  select count(*) into n from marketing_email_suppressions where email = 'not-an-address';
  if n <> 0 then raise exception 'FAIL 8b: a non-email must not be suppressed'; end if;

  -- 9. Bad input is rejected without writing anything.
  ok := record_email_event(null, 'email.bounced', now(), 'e', 'a@educoreafrica.com', 'bad1@esu.invalid', 's', 'Permanent / General', 'x');
  if ok then raise exception 'FAIL 9a: null svix id should be rejected'; end if;
  ok := record_email_event('t-svix-12', 'not.an.email.event', now(), 'e', 'a@educoreafrica.com', 'bad2@esu.invalid', 's', 'Permanent / General', 'x');
  if ok then raise exception 'FAIL 9b: non-email event type should be rejected'; end if;
  select count(*) into n from marketing_email_suppressions where email in ('bad1@esu.invalid', 'bad2@esu.invalid');
  if n <> 0 then raise exception 'FAIL 9c: rejected input must not suppress'; end if;

  -- 10. Still service-role only: the browser roles cannot call it.
  perform pg_temp.as_anon();
  begin
    perform record_email_event('t-svix-13', 'email.bounced', now(), 'e', 'a@educoreafrica.com', 'anon1@esu.invalid', 's', 'Permanent / General', 'x');
    err := '';
  exception when others then
    err := sqlerrm;
  end;
  perform pg_temp.as_owner();
  if err = '' then raise exception 'FAIL 10: anon must not be able to call record_email_event'; end if;

  raise notice 'email_event_suppression: all passed';
end $$;

rollback;
