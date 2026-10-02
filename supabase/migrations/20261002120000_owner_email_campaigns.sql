-- Promotional email campaigns to school owners, sent from the platform admin console.
--
-- Audience is deliberately narrow: ACTIVE school_owner users of schools that are 'active' or
-- 'trial' (never 'suspended'), excluding the demo/QA tenants and reserved test addresses, deduped
-- by lower(email) so an owner of several schools gets one copy. Nothing is sent from SQL -- this
-- migration only holds the data and the access rules; sending happens in the
-- send-owner-campaign Edge Function (Resend), which needs the service role.
--
-- Safe to run twice: every statement is create-if-not-exists / create-or-replace.

-- ============================================================
-- Suppression list (one row per unsubscribed address)
-- ============================================================
create table if not exists public.marketing_email_suppressions (
  email text primary key check (email = lower(email)),
  reason text not null default 'unsubscribed' check (reason in ('unsubscribed', 'manual', 'bounced', 'complained')),
  campaign_id uuid,
  created_at timestamptz not null default now()
);

comment on table public.marketing_email_suppressions is
  'Addresses that must never receive promotional email. Checked at campaign creation AND again at send time. Not used for transactional mail (OTP, billing, school communications).';

-- ============================================================
-- Campaigns
-- ============================================================
create table if not exists public.email_campaigns (
  id uuid primary key default gen_random_uuid(),
  subject text not null check (char_length(trim(subject)) between 1 and 200),
  body text not null check (char_length(trim(body)) between 1 and 10000),
  audience text not null default 'school_owners' check (audience in ('school_owners')),
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now()
);

create table if not exists public.email_campaign_recipients (
  id uuid primary key default gen_random_uuid(),
  campaign_id uuid not null references public.email_campaigns(id) on delete cascade,
  school_id uuid references public.schools(id) on delete set null,
  school_name text not null,
  recipient_name text,
  email text not null check (email = lower(email)),
  unsubscribe_token uuid not null default gen_random_uuid() unique,
  -- queued -> sending (claimed) -> sent | failed. A row stuck in 'sending' means a send was
  -- interrupted mid-flight; it is NEVER auto-retried, because a duplicate email to an owner is
  -- worse than one missed send. Review those by hand.
  status text not null default 'queued' check (status in ('queued', 'sending', 'sent', 'failed', 'skipped_unsubscribed')),
  error text,
  claimed_at timestamptz,
  sent_at timestamptz,
  created_at timestamptz not null default now(),
  unique (campaign_id, email)
);

create index if not exists idx_email_campaign_recipients_campaign_status
  on public.email_campaign_recipients (campaign_id, status);

-- Locked down: no client policies at all. Access is only through the SECURITY DEFINER functions
-- below (super_admin) and the service role (Edge Function / unsubscribe route).
alter table public.marketing_email_suppressions enable row level security;
alter table public.email_campaigns enable row level security;
alter table public.email_campaign_recipients enable row level security;

revoke all on public.marketing_email_suppressions from anon, authenticated;
revoke all on public.email_campaigns from anon, authenticated;
revoke all on public.email_campaign_recipients from anon, authenticated;

-- ============================================================
-- Audience (single source of truth, used by preview and by create)
-- ============================================================
create or replace function public._owner_campaign_audience()
returns table (
  school_id uuid,
  school_name text,
  school_status text,
  owner_name text,
  email text,
  suppressed boolean
)
language sql
stable
security definer
set search_path to 'public'
as $$
  select distinct on (lower(su.email))
    s.id,
    s.name,
    s.status,
    su.full_name,
    lower(su.email),
    exists (select 1 from public.marketing_email_suppressions m where m.email = lower(su.email))
  from public.school_users su
  join public.roles r on r.id = su.role_id and r.name = 'school_owner'
  join public.schools s on s.id = su.school_id
  where su.status = 'active'
    and su.email is not null
    and trim(su.email) <> ''
    and s.status in ('active', 'trial')
    -- Demo / QA tenants and reserved test addresses never get real marketing mail.
    and s.slug <> 'demo-academy'
    and s.slug not like 'qa-%'
    and lower(su.email) not like '%@educore.test'
    and lower(su.email) not like '%.test'
  order by lower(su.email), s.name;
$$;

revoke all on function public._owner_campaign_audience() from public, anon, authenticated;
grant execute on function public._owner_campaign_audience() to service_role;

create or replace function public.preview_owner_campaign_audience()
returns table (
  school_id uuid,
  school_name text,
  school_status text,
  owner_name text,
  email text,
  suppressed boolean
)
language plpgsql
stable
security definer
set search_path to 'public'
as $$
begin
  if not (auth_is_super_admin() or auth.role() = 'service_role') then
    raise exception 'Not authorized to preview the campaign audience.';
  end if;
  -- Qualified on purpose: the RETURNS TABLE column names are also plpgsql variables, so a bare
  -- "school_name" here would be an ambiguous reference.
  return query select a.* from public._owner_campaign_audience() a order by a.school_name;
end;
$$;

revoke all on function public.preview_owner_campaign_audience() from public, anon;
grant execute on function public.preview_owner_campaign_audience() to authenticated;

-- ============================================================
-- Create a campaign: snapshots the recipients at this moment
-- ============================================================
create or replace function public.create_owner_email_campaign(
  p_subject text,
  p_body text,
  p_excluded_emails text[] default '{}'
)
returns uuid
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_campaign_id uuid;
  v_inserted integer;
begin
  if not (auth_is_super_admin() or auth.role() = 'service_role') then
    raise exception 'Not authorized to create an email campaign.';
  end if;
  if coalesce(trim(p_subject), '') = '' then
    raise exception 'Subject is required.';
  end if;
  if coalesce(trim(p_body), '') = '' then
    raise exception 'Body is required.';
  end if;

  insert into public.email_campaigns (subject, body, created_by)
  values (trim(p_subject), trim(p_body), auth.uid())
  returning id into v_campaign_id;

  insert into public.email_campaign_recipients (campaign_id, school_id, school_name, recipient_name, email)
  select v_campaign_id, a.school_id, a.school_name, a.owner_name, a.email
  from public._owner_campaign_audience() a
  where not a.suppressed
    and a.email <> all (select lower(x) from unnest(coalesce(p_excluded_emails, '{}')) as x);

  get diagnostics v_inserted = row_count;
  if v_inserted = 0 then
    raise exception 'No eligible recipients: everyone is unsubscribed, excluded, or no active school owners were found.';
  end if;

  return v_campaign_id;
end;
$$;

revoke all on function public.create_owner_email_campaign(text, text, text[]) from public, anon;
grant execute on function public.create_owner_email_campaign(text, text, text[]) to authenticated;

-- ============================================================
-- History (last 20 campaigns with delivery counts)
-- ============================================================
create or replace function public.get_email_campaign_history()
returns table (
  id uuid,
  subject text,
  created_at timestamptz,
  total bigint,
  sent bigint,
  failed bigint,
  skipped bigint,
  pending bigint
)
language plpgsql
stable
security definer
set search_path to 'public'
as $$
begin
  if not (auth_is_super_admin() or auth.role() = 'service_role') then
    raise exception 'Not authorized to view email campaign history.';
  end if;

  return query
  select c.id, c.subject, c.created_at,
    count(r.id),
    count(r.id) filter (where r.status = 'sent'),
    count(r.id) filter (where r.status = 'failed'),
    count(r.id) filter (where r.status = 'skipped_unsubscribed'),
    count(r.id) filter (where r.status in ('queued', 'sending'))
  from public.email_campaigns c
  left join public.email_campaign_recipients r on r.campaign_id = c.id
  group by c.id
  order by c.created_at desc
  limit 20;
end;
$$;

revoke all on function public.get_email_campaign_history() from public, anon;
grant execute on function public.get_email_campaign_history() to authenticated;

-- ============================================================
-- Claim the next batch to send (service role only)
-- ============================================================
-- Re-checks the suppression list at send time, so someone who unsubscribes between campaign
-- creation and delivery is skipped. FOR UPDATE SKIP LOCKED + the status flip means two
-- overlapping invocations can never claim the same recipient.
create or replace function public.claim_campaign_recipients(p_campaign_id uuid, p_limit integer default 20)
returns table (
  id uuid,
  email text,
  recipient_name text,
  school_name text,
  unsubscribe_token uuid
)
language plpgsql
security definer
set search_path to 'public'
as $$
begin
  update public.email_campaign_recipients r
  set status = 'skipped_unsubscribed'
  where r.campaign_id = p_campaign_id
    and r.status = 'queued'
    and exists (select 1 from public.marketing_email_suppressions m where m.email = r.email);

  return query
  update public.email_campaign_recipients r
  set status = 'sending', claimed_at = now()
  where r.id in (
    select q.id
    from public.email_campaign_recipients q
    where q.campaign_id = p_campaign_id and q.status = 'queued'
    order by q.created_at, q.id
    limit greatest(1, least(coalesce(p_limit, 20), 50))
    for update skip locked
  )
  returning r.id, r.email, r.recipient_name, r.school_name, r.unsubscribe_token;
end;
$$;

revoke all on function public.claim_campaign_recipients(uuid, integer) from public, anon, authenticated;
grant execute on function public.claim_campaign_recipients(uuid, integer) to service_role;

-- ============================================================
-- Unsubscribe by token (service role only; called by the public /unsubscribe route)
-- ============================================================
create or replace function public.unsubscribe_marketing_email(p_token uuid)
returns boolean
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_email text;
  v_campaign uuid;
begin
  select r.email, r.campaign_id into v_email, v_campaign
  from public.email_campaign_recipients r
  where r.unsubscribe_token = p_token;

  if v_email is null then
    return false;
  end if;

  insert into public.marketing_email_suppressions (email, reason, campaign_id)
  values (v_email, 'unsubscribed', v_campaign)
  on conflict (email) do nothing;

  return true;
end;
$$;

revoke all on function public.unsubscribe_marketing_email(uuid) from public, anon, authenticated;
grant execute on function public.unsubscribe_marketing_email(uuid) to service_role;
