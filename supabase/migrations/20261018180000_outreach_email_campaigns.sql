-- Outreach email: send the reviewed per-school drafts of APPROVED outbound prospects through the existing
-- campaign pipeline (send-owner-campaign: batches, suppression re-check, unsubscribe link + one-click header,
-- recipient status), plus a bell notification whenever someone unsubscribes.
--
-- Safety posture (nothing here sends anything by itself; sending is always a super-admin click):
--   * Only prospects that are approved/promoted, whose contact details a person has confirmed (not merely
--     scraped / AI-found), who have an email and a reviewed draft, who are not suppressed, not already
--     onboarded, and never emailed before (by this pipeline or logged as 'sent' by hand) are eligible.
--   * A rolling-24h cap (50) limits how many outreach emails can be queued, to protect sender reputation.
--   * Each recipient row stores the exact subject/body that was reviewed, so what is sent is what was approved.
--   * Unsubscribes already land in marketing_email_suppressions (checked at create AND send time); this adds
--     a platform notification and an 'opted_out' entry in the prospect's contact log.
--
-- Additive and safe to run twice. No existing rows are rewritten.

-- ============================================================
-- 1. Campaign audience + per-recipient content
-- ============================================================
alter table public.email_campaigns drop constraint if exists email_campaigns_audience_check;
alter table public.email_campaigns
  add constraint email_campaigns_audience_check check (audience in ('school_owners', 'prospects', 'outreach'));

alter table public.email_campaign_recipients
  add column if not exists prospect_id uuid references public.outbound_prospects(id) on delete set null,
  add column if not exists custom_subject text check (custom_subject is null or char_length(custom_subject) <= 200),
  add column if not exists custom_body text check (custom_body is null or char_length(custom_body) <= 10000);

create index if not exists email_campaign_recipients_prospect_idx
  on public.email_campaign_recipients (prospect_id) where prospect_id is not null;

-- ============================================================
-- 2. Daily cap (rolling 24h) -- one place to change it
-- ============================================================
create or replace function public._outreach_email_daily_cap()
returns integer
language sql
immutable
set search_path to 'public'
as $$ select 50 $$;

revoke all on function public._outreach_email_daily_cap() from public, anon, authenticated;
grant execute on function public._outreach_email_daily_cap() to service_role;

create or replace function public.admin_outreach_email_quota()
returns table (cap integer, used integer, remaining integer)
language plpgsql
stable
security definer
set search_path to 'public'
as $$
declare
  v_cap integer := public._outreach_email_daily_cap();
  v_used integer;
begin
  if not auth_is_super_admin() then
    raise exception 'Not authorized to manage outbound prospects.';
  end if;

  select count(*)::integer into v_used
  from public.email_campaign_recipients r
  join public.email_campaigns c on c.id = r.campaign_id
  where c.audience = 'outreach'
    and r.created_at > now() - interval '24 hours'
    and r.status in ('queued', 'sending', 'sent');

  return query select v_cap, v_used, greatest(0, v_cap - v_used);
end;
$$;

revoke all on function public.admin_outreach_email_quota() from public, anon;
grant execute on function public.admin_outreach_email_quota() to authenticated;

-- ============================================================
-- 3. Eligible prospects (single source of truth for preview and create)
-- ============================================================
create or replace function public._outreach_email_audience()
returns table (
  prospect_id uuid,
  school_name text,
  town_county text,
  email text,
  contact_name text,
  subject text,
  body text,
  fit_score integer
)
language sql
stable
security definer
set search_path to 'public'
as $$
  select p.id,
         p.school_name,
         p.town_county,
         public._normalize_contact_identifier('email', p.email) as email,
         p.contact_name,
         btrim(p.draft_email_subject),
         btrim(p.draft_email_body),
         p.fit_score
  from public.outbound_prospects p
  where p.status in ('approved', 'promoted')
    -- Details found by a scraper / AI search stay unusable until a person confirms them.
    and (p.contact_status is null or p.contact_status = 'verified')
    and public._normalize_contact_identifier('email', p.email) is not null
    and nullif(btrim(p.draft_email_subject), '') is not null
    and nullif(btrim(p.draft_email_body), '') is not null
    and not exists (
      select 1 from public.marketing_email_suppressions m
      where m.email = public._normalize_contact_identifier('email', p.email)
    )
    -- Already a customer / onboarded.
    and not exists (
      select 1 from public.school_users su
      where lower(su.email) = public._normalize_contact_identifier('email', p.email)
    )
    -- Never email the same school or address twice (queued / in flight / sent counts as emailed).
    and not exists (
      select 1 from public.email_campaign_recipients r
      join public.email_campaigns c on c.id = r.campaign_id
      where c.audience = 'outreach'
        and r.status in ('queued', 'sending', 'sent')
        and (r.prospect_id = p.id or r.email = public._normalize_contact_identifier('email', p.email))
    )
    -- Or logged as emailed by hand / replied / opted out.
    and not exists (
      select 1 from public.outbound_contact_log l
      where l.prospect_id = p.id
        and l.channel = 'email'
        and l.event in ('sent', 'replied', 'opted_out')
    );
$$;

revoke all on function public._outreach_email_audience() from public, anon, authenticated;
grant execute on function public._outreach_email_audience() to service_role;

create or replace function public.preview_outreach_email_audience()
returns table (
  prospect_id uuid,
  school_name text,
  town_county text,
  email text,
  contact_name text,
  subject text,
  body text,
  fit_score integer
)
language plpgsql
stable
security definer
set search_path to 'public'
as $$
begin
  if not auth_is_super_admin() then
    raise exception 'Not authorized to manage outbound prospects.';
  end if;
  return query
    select a.prospect_id, a.school_name, a.town_county, a.email, a.contact_name, a.subject, a.body, a.fit_score
    from public._outreach_email_audience() a
    order by a.fit_score desc nulls last, a.school_name
    limit 500;
end;
$$;

revoke all on function public.preview_outreach_email_audience() from public, anon;
grant execute on function public.preview_outreach_email_audience() to authenticated;

-- ============================================================
-- 4. Create the campaign (snapshots the reviewed drafts; sends nothing)
-- ============================================================
create or replace function public.create_outreach_email_campaign(p_prospect_ids uuid[])
returns uuid
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_ids uuid[];
  v_requested integer;
  v_eligible integer;
  v_remaining integer;
  v_campaign_id uuid;
begin
  if not auth_is_super_admin() then
    raise exception 'Not authorized to manage outbound prospects.';
  end if;

  select coalesce(array_agg(distinct x), '{}') into v_ids from unnest(coalesce(p_prospect_ids, '{}')) as x;
  v_requested := coalesce(array_length(v_ids, 1), 0);
  if v_requested = 0 then
    raise exception 'Choose at least one school to email.';
  end if;

  select q.remaining into v_remaining from public.admin_outreach_email_quota() q;
  if v_requested > v_remaining then
    raise exception 'Daily limit: you can queue % more outreach email(s) in the next 24 hours (limit %).',
      v_remaining, public._outreach_email_daily_cap();
  end if;

  select count(*)::integer into v_eligible
  from public._outreach_email_audience() a
  where a.prospect_id = any (v_ids);
  if v_eligible <> v_requested then
    raise exception 'Some of the chosen schools are no longer eligible (unsubscribed, already emailed, or details changed). Reload the list and try again.';
  end if;

  insert into public.email_campaigns (subject, body, audience, created_by)
  values (
    'Outreach: ' || v_requested || ' school(s), ' || to_char(now() at time zone 'Africa/Nairobi', 'YYYY-MM-DD'),
    'Per-school reviewed drafts (see each recipient).',
    'outreach',
    auth.uid()
  )
  returning id into v_campaign_id;

  insert into public.email_campaign_recipients
    (campaign_id, school_id, school_name, recipient_name, email, prospect_id, custom_subject, custom_body)
  select v_campaign_id, null, a.school_name, a.contact_name, a.email, a.prospect_id, left(a.subject, 200), left(a.body, 10000)
  from public._outreach_email_audience() a
  where a.prospect_id = any (v_ids);

  return v_campaign_id;
end;
$$;

revoke all on function public.create_outreach_email_campaign(uuid[]) from public, anon;
grant execute on function public.create_outreach_email_campaign(uuid[]) to authenticated;

-- ============================================================
-- 5. Notify the platform admin when someone unsubscribes
-- ============================================================
alter table public.platform_notifications drop constraint if exists platform_notifications_kind_check;
alter table public.platform_notifications
  add constraint platform_notifications_kind_check
  check (kind in ('demo_request', 'lead_magnet', 'demo_partial_lead', 'email_unsubscribe'));

create or replace function public.unsubscribe_marketing_email(p_token uuid)
returns boolean
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_email text;
  v_campaign uuid;
  v_prospect uuid;
  v_school text;
  v_subject text;
  v_audience text;
  v_new integer;
begin
  select r.email, r.campaign_id, r.prospect_id, r.school_name
    into v_email, v_campaign, v_prospect, v_school
  from public.email_campaign_recipients r
  where r.unsubscribe_token = p_token;

  if v_email is null then
    select s.email into v_email
    from public.prospect_sequence_sends s
    where s.unsubscribe_token = p_token;
    v_campaign := null;
  end if;

  if v_email is null then
    return false;
  end if;

  insert into public.marketing_email_suppressions (email, reason, campaign_id)
  values (v_email, 'unsubscribed', v_campaign)
  on conflict (email) do nothing;
  get diagnostics v_new = row_count;

  -- Only the first time (a repeat click or a mail scanner must not raise another alert).
  if v_new > 0 then
    if v_campaign is not null then
      select c.subject, c.audience into v_subject, v_audience from public.email_campaigns c where c.id = v_campaign;
    end if;

    if v_prospect is not null then
      insert into public.outbound_contact_log (prospect_id, channel, event, note)
      values (v_prospect, 'email', 'opted_out', 'Unsubscribed via the email link');
    end if;

    insert into public.platform_notifications (kind, title, body, action_path, related_table)
    values (
      'email_unsubscribe',
      'Email unsubscribed',
      v_email
        || coalesce(' (' || nullif(btrim(v_school), '') || ')', '')
        || ' unsubscribed'
        || case
             when v_audience = 'outreach' then ' from outreach email.'
             when v_subject is not null then ' from the campaign "' || left(v_subject, 80) || '".'
             else ' from marketing email.'
           end
        || ' They will not be emailed again.',
      case when v_audience = 'outreach' then '/admin/outreach' else '/admin/email-campaigns' end,
      'marketing_email_suppressions'
    );
  end if;

  return true;
end;
$$;

revoke all on function public.unsubscribe_marketing_email(uuid) from public, anon, authenticated;
grant execute on function public.unsubscribe_marketing_email(uuid) to service_role;
