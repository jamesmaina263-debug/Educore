-- Outreach engagement: record WHICH school opened or clicked an outreach email, and show it to platform staff.
--
-- Why: the outreach pipeline sends each school its own reviewed email (email_campaign_recipients, one row per
-- school, with prospect_id), but nothing recorded whether the school engaged afterwards. This adds two things:
--   1. outreach_link_clicks: one row per click on a per-school tracked link. The link carries the recipient's
--      id (an unguessable uuid), so a click identifies the school without any cookie or login.
--   2. admin_outreach_engagement(): per school, clicks (human and probable-scanner counted apart) plus the
--      Resend open/click events already landing in email_delivery_events, joined on the recipient's address.
--
-- Scanner hygiene: mail-security scanners (and some mail clients) fetch every link the moment a message
-- arrives. A click is flagged is_probable_bot when the caller's user agent looks automated OR it arrives within
-- 15 seconds of the send time. Flagged clicks are still stored (so nothing is silently lost) but are counted
-- separately and never shown as "visited".
--
-- Additive and safe to run twice: one new table, two new functions. No existing table, function, column or
-- row is changed. Writes happen only through record_outreach_click() (service role); reads only through
-- admin_outreach_engagement() (super admin).

-- ============================================================
-- 1. Click log
-- ============================================================
create table if not exists public.outreach_link_clicks (
  id bigint generated always as identity primary key,
  created_at timestamptz not null default now(),
  recipient_id uuid not null references public.email_campaign_recipients(id) on delete cascade,
  -- Deleting a prospect (admin_delete_outbound_prospect) removes its click history with it.
  prospect_id uuid not null references public.outbound_prospects(id) on delete cascade,
  destination text not null check (destination in ('home', 'signup', 'contact', 'brochure')),
  is_probable_bot boolean not null default false,
  seconds_after_send integer
);

comment on table public.outreach_link_clicks is
  'Clicks on per-school tracked links in outreach emails. Written only by record_outreach_click() via the service role; read only through admin_outreach_engagement() by super admins.';

create index if not exists outreach_link_clicks_prospect_idx
  on public.outreach_link_clicks (prospect_id, created_at desc);
create index if not exists outreach_link_clicks_recipient_dest_idx
  on public.outreach_link_clicks (recipient_id, destination, created_at desc);

alter table public.outreach_link_clicks enable row level security;
revoke all on public.outreach_link_clicks from anon, authenticated;
revoke all on sequence public.outreach_link_clicks_id_seq from anon, authenticated;

-- ============================================================
-- 2. Write: record one click (service role only)
-- ============================================================
-- Returns true when a click row was written. Returns false (and writes nothing) for an unknown or unsent
-- recipient, a recipient that is not part of an outreach campaign, an unknown destination, or a repeat of the
-- same click within 60 seconds (a refresh or double-tap). It never raises on bad input, so the public route
-- that calls it can always still redirect the visitor.
create or replace function public.record_outreach_click(
  p_recipient_id uuid,
  p_destination text,
  p_is_probable_bot boolean
)
returns boolean
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_prospect uuid;
  v_sent_at timestamptz;
  v_seconds integer;
  v_bot boolean;
begin
  if p_recipient_id is null or p_destination is null
     or p_destination not in ('home', 'signup', 'contact', 'brochure') then
    return false;
  end if;

  select r.prospect_id, r.sent_at
    into v_prospect, v_sent_at
    from public.email_campaign_recipients r
    join public.email_campaigns c on c.id = r.campaign_id
   where r.id = p_recipient_id
     and r.status = 'sent'
     and r.prospect_id is not null
     and c.audience = 'outreach';

  if v_prospect is null then
    return false;
  end if;

  v_seconds := case when v_sent_at is null then null
                    else greatest(0, floor(extract(epoch from (now() - v_sent_at)))::integer) end;
  v_bot := coalesce(p_is_probable_bot, false) or (v_seconds is not null and v_seconds < 15);

  if exists (
    select 1 from public.outreach_link_clicks k
     where k.recipient_id = p_recipient_id
       and k.destination = p_destination
       and k.is_probable_bot = v_bot
       and k.created_at > now() - interval '60 seconds'
  ) then
    return false;
  end if;

  insert into public.outreach_link_clicks (recipient_id, prospect_id, destination, is_probable_bot, seconds_after_send)
  values (p_recipient_id, v_prospect, p_destination, v_bot, v_seconds);

  return true;
end;
$$;

revoke all on function public.record_outreach_click(uuid, text, boolean) from public, anon, authenticated;
grant execute on function public.record_outreach_click(uuid, text, boolean) to service_role;

-- ============================================================
-- 3. Read: per-school engagement for the Outreach page (super admin)
-- ============================================================
-- One row per school that has any signal. Counts are all-time. Opens and Resend-reported clicks come from
-- email_delivery_events (event types email.opened / email.clicked, present once those are enabled in Resend
-- and added to the webhook); they are matched on the recipient's address and only count from the moment that
-- email was sent. Opens are a weak signal (Apple Mail pre-loads images), so the page labels them accordingly.
create or replace function public.admin_outreach_engagement()
returns table (
  prospect_id uuid,
  clicks integer,
  bot_clicks integer,
  last_click_at timestamptz,
  last_click_destination text,
  destinations text[],
  opens integer,
  last_open_at timestamptz,
  provider_clicks integer,
  last_provider_click_at timestamptz
)
language plpgsql
stable
security definer
set search_path to 'public'
as $$
begin
  if not auth_is_super_admin() then
    raise exception 'Not authorized to view outreach engagement.';
  end if;

  return query
  with own as (
    select k.prospect_id,
           (count(*) filter (where not k.is_probable_bot))::integer as clicks,
           (count(*) filter (where k.is_probable_bot))::integer as bot_clicks,
           max(k.created_at) filter (where not k.is_probable_bot) as last_click_at,
           (array_agg(k.destination order by k.created_at desc) filter (where not k.is_probable_bot))[1] as last_click_destination,
           coalesce(array_agg(distinct k.destination) filter (where not k.is_probable_bot), '{}'::text[]) as destinations
      from public.outreach_link_clicks k
     group by k.prospect_id
  ),
  prov as (
    select r.prospect_id,
           (count(*) filter (where e.event_type = 'email.opened'))::integer as opens,
           max(e.occurred_at) filter (where e.event_type = 'email.opened') as last_open_at,
           (count(*) filter (where e.event_type = 'email.clicked'))::integer as provider_clicks,
           max(e.occurred_at) filter (where e.event_type = 'email.clicked') as last_provider_click_at
      from public.email_campaign_recipients r
      join public.email_campaigns c on c.id = r.campaign_id and c.audience = 'outreach'
      join public.email_delivery_events e
        on e.to_address = r.email
       and e.event_type in ('email.opened', 'email.clicked')
       and r.sent_at is not null
       and e.occurred_at >= r.sent_at
     where r.status = 'sent'
       and r.prospect_id is not null
     group by r.prospect_id
  )
  select coalesce(o.prospect_id, p.prospect_id) as prospect_id,
         coalesce(o.clicks, 0),
         coalesce(o.bot_clicks, 0),
         o.last_click_at,
         o.last_click_destination,
         coalesce(o.destinations, '{}'::text[]),
         coalesce(p.opens, 0),
         p.last_open_at,
         coalesce(p.provider_clicks, 0),
         p.last_provider_click_at
    from own o
    full join prov p on p.prospect_id = o.prospect_id;
end;
$$;

revoke all on function public.admin_outreach_engagement() from public, anon;
grant execute on function public.admin_outreach_engagement() to authenticated;
