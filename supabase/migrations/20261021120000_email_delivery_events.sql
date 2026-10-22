-- Email delivery tracking from Resend webhooks (step 1 of 2: the database half).
--
-- Why: outreach and campaign emails go through Resend, but nothing records whether they were delivered,
-- bounced or marked as spam, so a deliverability problem is invisible until replies dry up. Resend can call a
-- webhook for each of those events; this stores them and lets the admin analytics page summarise them.
--
-- What it stores per event: the event type, when it happened, Resend's email id, the sender and the first
-- recipient address, the subject, and for bounces the bounce type and reason. Recipient addresses are personal
-- data, so the table is super-admin-read-only and events are purged after 180 days (purge_old_email_events).
-- Resend's email id is kept so a later change can tie an event back to a particular send; nothing here
-- changes how any email is sent.
--
-- Write path: the /api/webhooks/resend route (signature-verified), service role only, via record_email_event().
-- There is deliberately NO anon/authenticated table grant and no policy, so the table cannot be read or
-- written from the browser with the anon key.
-- Read path: admin_email_delivery_summary(), super admin only (checks auth_is_super_admin()).
--
-- Additive only: one new table and three new functions. Nothing existing is touched. Safe to run twice.

create table if not exists public.email_delivery_events (
  id bigint generated always as identity primary key,
  created_at timestamptz not null default now(),
  -- Svix message id from the webhook delivery. Resend retries failed deliveries, so this makes recording
  -- idempotent: the same webhook delivered twice is stored once.
  svix_id text not null unique check (char_length(svix_id) between 1 and 200),
  event_type text not null check (event_type like 'email.%' and char_length(event_type) <= 60),
  occurred_at timestamptz not null,
  email_id text check (email_id is null or char_length(email_id) <= 100),
  from_address text check (from_address is null or char_length(from_address) <= 320),
  to_address text check (to_address is null or char_length(to_address) <= 320),
  subject text check (subject is null or char_length(subject) <= 300),
  bounce_type text check (bounce_type is null or char_length(bounce_type) <= 60),
  bounce_reason text check (bounce_reason is null or char_length(bounce_reason) <= 500)
);

comment on table public.email_delivery_events is
  'Resend webhook events (delivered, bounced, complained, delayed, failed). Written only by record_email_event() via the service role; read only through admin_email_delivery_summary() by super admins; purged after 180 days.';

create index if not exists email_delivery_events_occurred_at_idx on public.email_delivery_events (occurred_at);
create index if not exists email_delivery_events_type_occurred_idx on public.email_delivery_events (event_type, occurred_at);

alter table public.email_delivery_events enable row level security;
revoke all on public.email_delivery_events from anon, authenticated;
revoke all on sequence public.email_delivery_events_id_seq from anon, authenticated;

-- ---------- write: one event, idempotent ----------
create or replace function public.record_email_event(
  p_svix_id text,
  p_event_type text,
  p_occurred_at timestamptz,
  p_email_id text,
  p_from text,
  p_to text,
  p_subject text,
  p_bounce_type text,
  p_bounce_reason text
)
returns boolean
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_inserted integer;
begin
  if p_svix_id is null or btrim(p_svix_id) = '' or p_event_type is null or p_event_type not like 'email.%' then
    return false;
  end if;

  insert into public.email_delivery_events
    (svix_id, event_type, occurred_at, email_id, from_address, to_address, subject, bounce_type, bounce_reason)
  values
    (left(p_svix_id, 200),
     left(p_event_type, 60),
     coalesce(p_occurred_at, now()),
     left(p_email_id, 100),
     left(p_from, 320),
     left(lower(p_to), 320),
     left(p_subject, 300),
     left(p_bounce_type, 60),
     left(p_bounce_reason, 500))
  on conflict (svix_id) do nothing;

  get diagnostics v_inserted = row_count;
  return v_inserted > 0;
end;
$$;

revoke all on function public.record_email_event(text, text, timestamptz, text, text, text, text, text, text)
  from public, anon, authenticated;
grant execute on function public.record_email_event(text, text, timestamptz, text, text, text, text, text, text)
  to service_role;

-- ---------- retention ----------
create or replace function public.purge_old_email_events(p_days integer default 180)
returns integer
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_deleted integer;
begin
  if p_days is null or p_days < 30 then
    raise exception 'Refusing to purge events newer than 30 days.';
  end if;
  delete from public.email_delivery_events where occurred_at < now() - make_interval(days => p_days);
  get diagnostics v_deleted = row_count;
  return v_deleted;
end;
$$;

revoke all on function public.purge_old_email_events(integer) from public, anon, authenticated;
grant execute on function public.purge_old_email_events(integer) to service_role;

-- ---------- read: summary for /admin/analytics ----------
-- Counts are of events whose Kenya-time day falls in [p_from, p_to]. "tracking_since" and "total_events" are
-- all-time, so the page can tell "no events yet" (the webhook may not be connected) from "none in this range".
create or replace function public.admin_email_delivery_summary(p_from date, p_to date)
returns jsonb
language plpgsql
stable
security definer
set search_path to 'public'
as $$
declare
  v_start timestamptz;
  v_end timestamptz;
  v_totals jsonb;
  v_senders jsonb;
  v_problems jsonb;
  v_since timestamptz;
  v_all bigint;
begin
  if not auth_is_super_admin() then
    raise exception 'Not authorized to view email delivery.';
  end if;
  if p_from is null or p_to is null or p_from > p_to then
    raise exception 'Choose a valid date range.';
  end if;
  if p_to - p_from > 400 then
    raise exception 'Date range is too long (400 days at most).';
  end if;

  v_start := p_from::timestamp at time zone 'Africa/Nairobi';
  v_end := (p_to + 1)::timestamp at time zone 'Africa/Nairobi';

  select min(occurred_at), count(*) into v_since, v_all from public.email_delivery_events;

  select jsonb_build_object(
           'delivered', (count(*) filter (where event_type = 'email.delivered'))::int,
           'bounced', (count(*) filter (where event_type = 'email.bounced'))::int,
           'complained', (count(*) filter (where event_type = 'email.complained'))::int,
           'delayed', (count(*) filter (where event_type = 'email.delivery_delayed'))::int,
           'failed', (count(*) filter (where event_type = 'email.failed'))::int
         )
    into v_totals
    from public.email_delivery_events
   where occurred_at >= v_start and occurred_at < v_end;

  select coalesce(jsonb_agg(to_jsonb(s) order by s.attempts desc, s.from_address), '[]'::jsonb)
    into v_senders
    from (
      select coalesce(from_address, '(unknown)') as from_address,
             (count(*) filter (where event_type = 'email.delivered'))::int as delivered,
             (count(*) filter (where event_type = 'email.bounced'))::int as bounced,
             (count(*) filter (where event_type = 'email.complained'))::int as complained,
             (count(*) filter (where event_type in ('email.delivered', 'email.bounced', 'email.complained')))::int as attempts
        from public.email_delivery_events
       where occurred_at >= v_start and occurred_at < v_end
         and event_type in ('email.delivered', 'email.bounced', 'email.complained')
       group by 1
       order by attempts desc, from_address
       limit 10
    ) s;

  select coalesce(jsonb_agg(to_jsonb(p) order by p.occurred_at desc), '[]'::jsonb)
    into v_problems
    from (
      select occurred_at,
             to_char(occurred_at at time zone 'Africa/Nairobi', 'YYYY-MM-DD HH24:MI') as kenya_time,
             event_type,
             to_address,
             subject,
             bounce_type,
             bounce_reason
        from public.email_delivery_events
       where occurred_at >= v_start and occurred_at < v_end
         and event_type in ('email.bounced', 'email.complained')
       order by occurred_at desc
       limit 25
    ) p;

  return jsonb_build_object(
    'from', p_from,
    'to', p_to,
    'totals', v_totals,
    'senders', v_senders,
    'problems', v_problems,
    'tracking_since', v_since,
    'total_events', v_all
  );
end;
$$;

revoke all on function public.admin_email_delivery_summary(date, date) from public, anon;
grant execute on function public.admin_email_delivery_summary(date, date) to authenticated;
