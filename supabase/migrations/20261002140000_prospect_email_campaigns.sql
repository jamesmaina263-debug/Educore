-- Prospect email: (1) a "Prospects" audience for manual campaigns and (2) an automated, editable
-- email sequence for new prospects. Builds on 20261002120000_owner_email_campaigns.sql and reuses
-- its suppression list, unsubscribe tokens and send-time suppression re-check.
--
-- "Prospect" = someone who left an email on the marketing site but has no school_users row yet:
--   * marketing_demo_requests        (full demo request; archived/closed requests are skipped)
--   * marketing_leads                (CBC checklist download)
--   * marketing_demo_partial_leads   (step-1 of the demo form, never finished; MANUAL audience only,
--                                     never auto-enrolled in the sequence)
-- Anyone who later gets a school_users row (i.e. onboarded), anyone on the suppression list, and
-- internal/test addresses drop out automatically.
--
-- Safety posture for the automated sequence:
--   * OFF by default (prospect_sequence_settings.enabled = false).
--   * Only prospects first seen AFTER the sequence was first switched on are enrolled, so the
--     existing backlog is never blasted -- the backlog is handled with a manual campaign.
--   * Step 1 is skipped for prospects first seen more than 30 days ago.
--   * Each later step is spaced from when the previous step was actually SENT.
--   * A (email, step) pair is inserted before sending and never retried: a duplicate email is
--     worse than a missed one. Rows stuck in 'sending' are reviewed by hand.
--
-- Safe to run twice: create-if-not-exists / create-or-replace throughout.

-- ============================================================
-- Existing campaign tables: allow the 'prospects' audience and recipients with no school
-- ============================================================
alter table public.email_campaigns drop constraint if exists email_campaigns_audience_check;
alter table public.email_campaigns
  add constraint email_campaigns_audience_check check (audience in ('school_owners', 'prospects'));

alter table public.email_campaign_recipients alter column school_name drop not null;

-- ============================================================
-- Prospect audience (single source of truth for preview, create and the sequence)
-- ============================================================
create or replace function public._prospect_audience(p_include_partial boolean default true)
returns table (
  source text,
  prospect_name text,
  org_name text,
  email text,
  first_seen timestamptz,
  suppressed boolean
)
language sql
stable
security definer
set search_path to 'public'
as $$
  with raw as (
    select 'demo_request'::text as source, d.name as prospect_name, d.school_name as org_name,
           lower(trim(d.email)) as email, d.created_at, 1 as priority
    from public.marketing_demo_requests d
    where d.archived_at is null and d.status <> 'closed'
    union all
    select 'checklist_download', null, null, lower(trim(l.email)), l.created_at, 2
    from public.marketing_leads l
    union all
    select 'incomplete_demo_form', p.name, p.school_name, lower(trim(p.email)), p.created_at, 3
    from public.marketing_demo_partial_leads p
    where p_include_partial and p.status in ('incomplete', 'contacted')
  ),
  dedup as (
    select distinct on (r.email) r.email, r.source, r.prospect_name, r.org_name
    from raw r
    where r.email <> ''
    order by r.email, r.priority
  ),
  seen as (
    select r.email, min(r.created_at) as first_seen
    from raw r
    group by r.email
  )
  select d.source, d.prospect_name, d.org_name, d.email, s.first_seen,
         exists (select 1 from public.marketing_email_suppressions m where m.email = d.email)
  from dedup d
  join seen s on s.email = d.email
  where d.email like '%_@_%.__%'
    and d.email not like '%@educore.test'
    and d.email not like '%.test'
    and d.email not like '%@educoreafrica.com'
    -- Already onboarded (owner or any staff of a school) -> not a prospect any more.
    and not exists (select 1 from public.school_users su where lower(su.email) = d.email)
  order by s.first_seen desc;
$$;

revoke all on function public._prospect_audience(boolean) from public, anon, authenticated;
grant execute on function public._prospect_audience(boolean) to service_role;

create or replace function public.preview_prospect_campaign_audience()
returns table (
  source text,
  prospect_name text,
  org_name text,
  email text,
  first_seen timestamptz,
  suppressed boolean
)
language plpgsql
stable
security definer
set search_path to 'public'
as $$
#variable_conflict use_column
begin
  if not (auth_is_super_admin() or auth.role() = 'service_role') then
    raise exception 'Not authorized to preview the prospect audience.';
  end if;
  return query select a.* from public._prospect_audience(true) a order by a.first_seen desc;
end;
$$;

revoke all on function public.preview_prospect_campaign_audience() from public, anon;
grant execute on function public.preview_prospect_campaign_audience() to authenticated;

-- ============================================================
-- Create a prospect campaign: snapshots recipients at this moment
-- ============================================================
create or replace function public.create_prospect_email_campaign(
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

  insert into public.email_campaigns (subject, body, audience, created_by)
  values (trim(p_subject), trim(p_body), 'prospects', auth.uid())
  returning id into v_campaign_id;

  insert into public.email_campaign_recipients (campaign_id, school_id, school_name, recipient_name, email)
  select v_campaign_id, null, a.org_name, a.prospect_name, a.email
  from public._prospect_audience(true) a
  where not a.suppressed
    and a.email <> all (select lower(x) from unnest(coalesce(p_excluded_emails, '{}')) as x);

  get diagnostics v_inserted = row_count;
  if v_inserted = 0 then
    raise exception 'No eligible recipients: everyone is unsubscribed, excluded, already onboarded, or no prospects were found.';
  end if;

  return v_campaign_id;
end;
$$;

revoke all on function public.create_prospect_email_campaign(text, text, text[]) from public, anon;
grant execute on function public.create_prospect_email_campaign(text, text, text[]) to authenticated;

-- ============================================================
-- Automated sequence: settings, steps, sends
-- ============================================================
create table if not exists public.prospect_sequence_settings (
  id boolean primary key default true check (id),
  enabled boolean not null default false,
  -- Set the first time the sequence is switched on and never moved afterwards. Only prospects
  -- first seen at or after this moment are ever enrolled.
  enabled_at timestamptz,
  updated_at timestamptz not null default now(),
  updated_by uuid references auth.users(id) on delete set null
);

insert into public.prospect_sequence_settings (id) values (true) on conflict (id) do nothing;

create table if not exists public.prospect_sequence_steps (
  step_number integer primary key check (step_number between 1 and 5),
  -- Days after the prospect was first seen (step 1) or after the previous active step's
  -- delay (later steps). Must be strictly increasing across active steps.
  delay_days integer not null check (delay_days between 0 and 90),
  subject text not null check (char_length(trim(subject)) between 1 and 200),
  body text not null check (char_length(trim(body)) between 1 and 10000),
  active boolean not null default true,
  updated_at timestamptz not null default now()
);

-- Starter copy: an editable draft only. The sequence stays switched off until it is reviewed.
insert into public.prospect_sequence_steps (step_number, delay_days, subject, body) values
  (1, 0, 'Thanks for your interest in EduCore',
   E'Hello {{name}},\n\nThanks for your interest in EduCore. We build school management software for Kenyan schools: admissions, attendance, CBC and 8-4-4 exams, fees with M-Pesa, and SMS updates to parents.\n\nIf you have a question, or would like a walkthrough for {{school}}, just reply to this email and our team will get back to you.\n\nThe EduCore team'),
  (2, 3, 'Starting with one area at a time',
   E'Hello {{name}},\n\nA quick follow-up. You do not have to switch everything on at once: a school can start with one area, such as admissions or fee collection, and add other modules later.\n\nIf you tell us which matters most for {{school}}, we can show you exactly that. Just reply to this email.\n\nThe EduCore team'),
  (3, 7, 'Would a short demo help?',
   E'Hello {{name}},\n\nI wanted to check whether you would still like to see EduCore in action. Reply with a day and time that suit you and we will set up a short demo for {{school}}.\n\nIf now is not the right time, no problem. You can unsubscribe below and we will not email you again.\n\nThe EduCore team')
on conflict (step_number) do nothing;

create table if not exists public.prospect_sequence_sends (
  id uuid primary key default gen_random_uuid(),
  email text not null check (email = lower(email)),
  step_number integer not null,
  unsubscribe_token uuid not null default gen_random_uuid() unique,
  -- sending (claimed) -> sent | failed. 'sending' rows are NEVER auto-retried.
  status text not null default 'sending' check (status in ('sending', 'sent', 'failed')),
  error text,
  created_at timestamptz not null default now(),
  sent_at timestamptz,
  constraint prospect_sequence_sends_email_step_uniq unique (email, step_number)
);

alter table public.prospect_sequence_settings enable row level security;
alter table public.prospect_sequence_steps enable row level security;
alter table public.prospect_sequence_sends enable row level security;

revoke all on public.prospect_sequence_settings from anon, authenticated;
revoke all on public.prospect_sequence_steps from anon, authenticated;
revoke all on public.prospect_sequence_sends from anon, authenticated;

-- ============================================================
-- Admin read / save (super admin)
-- ============================================================
create or replace function public.admin_get_prospect_sequence()
returns jsonb
language plpgsql
stable
security definer
set search_path to 'public'
as $$
begin
  if not (auth_is_super_admin() or auth.role() = 'service_role') then
    raise exception 'Not authorized to view the prospect sequence.';
  end if;

  return (
    select jsonb_build_object(
      'enabled', s.enabled,
      'enabled_at', s.enabled_at,
      'steps', coalesce((
        select jsonb_agg(
          jsonb_build_object(
            'step_number', st.step_number,
            'delay_days', st.delay_days,
            'subject', st.subject,
            'body', st.body,
            'active', st.active,
            'sent', (select count(*) from public.prospect_sequence_sends x where x.step_number = st.step_number and x.status = 'sent'),
            'failed', (select count(*) from public.prospect_sequence_sends x where x.step_number = st.step_number and x.status = 'failed')
          )
          order by st.step_number
        )
        from public.prospect_sequence_steps st
      ), '[]'::jsonb)
    )
    from public.prospect_sequence_settings s
  );
end;
$$;

revoke all on function public.admin_get_prospect_sequence() from public, anon;
grant execute on function public.admin_get_prospect_sequence() to authenticated;

create or replace function public.admin_save_prospect_sequence(p_enabled boolean, p_steps jsonb)
returns void
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_step jsonb;
  v_n integer;
  v_delay integer;
  v_active boolean;
  v_prev_delay integer := -1;
  v_active_count integer := 0;
begin
  if not (auth_is_super_admin() or auth.role() = 'service_role') then
    raise exception 'Not authorized to change the prospect sequence.';
  end if;
  if p_steps is null or jsonb_typeof(p_steps) <> 'array' or jsonb_array_length(p_steps) = 0 then
    raise exception 'The sequence needs at least one step.';
  end if;

  for v_step in
    select t.e from jsonb_array_elements(p_steps) as t(e) order by (t.e->>'step_number')::integer
  loop
    v_n := (v_step->>'step_number')::integer;
    v_delay := (v_step->>'delay_days')::integer;
    v_active := coalesce((v_step->>'active')::boolean, true);

    if coalesce(trim(v_step->>'subject'), '') = '' or coalesce(trim(v_step->>'body'), '') = '' then
      raise exception 'Step % needs a subject and a message.', v_n;
    end if;

    if v_active then
      if v_delay <= v_prev_delay then
        raise exception 'Step % must be sent later than the step before it.', v_n;
      end if;
      v_prev_delay := v_delay;
      v_active_count := v_active_count + 1;
    end if;

    insert into public.prospect_sequence_steps (step_number, delay_days, subject, body, active, updated_at)
    values (v_n, v_delay, trim(v_step->>'subject'), trim(v_step->>'body'), v_active, now())
    on conflict (step_number) do update
      set delay_days = excluded.delay_days,
          subject = excluded.subject,
          body = excluded.body,
          active = excluded.active,
          updated_at = now();
  end loop;

  if p_enabled and v_active_count = 0 then
    raise exception 'Switch on at least one step before enabling the sequence.';
  end if;

  update public.prospect_sequence_settings
  set enabled = p_enabled,
      enabled_at = case when p_enabled and enabled_at is null then now() else enabled_at end,
      updated_at = now(),
      updated_by = auth.uid()
  where id = true;
end;
$$;

revoke all on function public.admin_save_prospect_sequence(boolean, jsonb) from public, anon;
grant execute on function public.admin_save_prospect_sequence(boolean, jsonb) to authenticated;

-- ============================================================
-- Claim the next due sends (service role only; called by the daily cron via an Edge Function)
-- ============================================================
create or replace function public.claim_prospect_sequence_sends(p_limit integer default 40)
returns table (
  id uuid,
  email text,
  prospect_name text,
  org_name text,
  step_number integer,
  subject text,
  body text,
  unsubscribe_token uuid
)
language plpgsql
security definer
set search_path to 'public'
as $$
#variable_conflict use_column
declare
  v_enabled boolean;
  v_enabled_at timestamptz;
begin
  select s.enabled, s.enabled_at into v_enabled, v_enabled_at
  from public.prospect_sequence_settings s;

  if not coalesce(v_enabled, false) or v_enabled_at is null then
    return;
  end if;

  return query
  with active_steps as (
    select st.step_number, st.delay_days, st.subject, st.body,
           lag(st.step_number) over (order by st.step_number) as prev_step,
           lag(st.delay_days) over (order by st.step_number) as prev_delay
    from public.prospect_sequence_steps st
    where st.active
  ),
  pros as (
    -- Auto-enrolment never includes unfinished demo forms (p_include_partial = false).
    select a.email, a.prospect_name, a.org_name, a.first_seen
    from public._prospect_audience(false) a
    where not a.suppressed
      and a.first_seen >= v_enabled_at
  ),
  due as (
    select p.email, p.prospect_name, p.org_name, s.step_number, s.subject, s.body, p.first_seen
    from pros p
    cross join active_steps s
    where not exists (
      select 1 from public.prospect_sequence_sends x
      where x.email = p.email and x.step_number = s.step_number
    )
    and (
      (s.prev_step is null
        and p.first_seen + make_interval(days => s.delay_days) <= now()
        and p.first_seen > now() - interval '30 days')
      or
      (s.prev_step is not null
        and exists (
          select 1 from public.prospect_sequence_sends y
          where y.email = p.email
            and y.step_number = s.prev_step
            and y.status = 'sent'
            and y.sent_at + make_interval(days => s.delay_days - s.prev_delay) <= now()
        ))
    )
    order by p.first_seen, s.step_number
    limit greatest(1, least(coalesce(p_limit, 40), 100))
  ),
  ins as (
    insert into public.prospect_sequence_sends as ps (email, step_number)
    select d.email, d.step_number from due d
    on conflict on constraint prospect_sequence_sends_email_step_uniq do nothing
    returning ps.id, ps.email, ps.step_number, ps.unsubscribe_token
  )
  select i.id, i.email, d.prospect_name, d.org_name, i.step_number, d.subject, d.body, i.unsubscribe_token
  from ins i
  join due d on d.email = i.email and d.step_number = i.step_number;
end;
$$;

revoke all on function public.claim_prospect_sequence_sends(integer) from public, anon, authenticated;
grant execute on function public.claim_prospect_sequence_sends(integer) to service_role;

-- ============================================================
-- Unsubscribe by token: now also understands sequence-email tokens
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

  return true;
end;
$$;

revoke all on function public.unsubscribe_marketing_email(uuid) from public, anon, authenticated;
grant execute on function public.unsubscribe_marketing_email(uuid) to service_role;
