-- Trial nudges (Growth Engine, Phase 2 item D): an approval queue, hard consent/frequency rules, and a send
-- path for emails to the OWNER of a trial school (or a school whose trial ended in the last 14 days).
--
-- Nothing is sent automatically. A person proposes a message, a person approves exactly that text, and a person
-- clicks Send. Sending is OFF by default (trial_nudge_settings) and promotional messages have their own switch,
-- also OFF by default, so merging this changes nothing for any school until someone turns it on.
--
-- Sending reuses the existing campaign pipeline instead of a second email path: approving + queueing creates a
-- one-recipient email_campaigns row whose recipient carries the approved text as custom_subject/custom_body (the
-- same mechanism outreach emails use, 20261018180000), and the existing send-owner-campaign Edge Function sends it
-- with the campaign sender identity, an unsubscribe link and List-Unsubscribe headers, skipping any address in
-- marketing_email_suppressions. No Edge Function changes.
--
-- Additive: two new tables and new functions. Nothing existing is altered, dropped or backfilled.
-- Needs 20261018150000_trial_checkins.sql, 20261018180000_outreach_email_campaigns.sql (custom_* columns, the
-- 'outreach' audience constraint) and 20261002120000_owner_email_campaigns.sql (campaign tables, suppressions).
--
-- Rules enforced here (propose, approve AND queue each re-check them; the UI only mirrors them):
--  * Recipient is the school's active owner, resolved in the database. It is never typed. If the owner's address
--    changes after approval, sending is refused.
--  * Service messages: schools whose trial is running. Promotional messages: running trials, or trials that ended
--    in the last 14 days (the win-back list). Demo / qa / test schools and test addresses are never messaged.
--  * Never to an address in marketing_email_suppressions (both kinds), never to a school with an 'asked_to_stop'
--    check-in (both kinds), and promotional never to a school with a 'reached_not_interested' check-in.
--  * Frequency: one open (proposed or approved) message per school; at most one message per school in 3 days
--    (any kind); at most 2 promotional per school in 30 days; at most 30 queued or sent platform-wide per 24 hours.
--  * Approval is bound to the exact text: approve passes the hash the reviewer saw; a changed message is refused.
--    Approved rows cannot be edited. An approval is valid for 24 hours, a proposal for 7 days.
--  * Content: unresolved placeholders, claims the product must not make (no "no obligation", no KICD/Ministry
--    approval, no guarantees) and links to any site other than educoreafrica.com are refused. A "service" message
--    that reads like an offer (discount, promo, coupon, ...) is refused, so an offer cannot skip the promotional gate.
--  * Access: super admin read only; every write is a SECURITY DEFINER function that checks auth_is_super_admin().
--    Who proposed / reviewed is a required platform_team_members id (the admin console is a shared login).

-- ============================================================
-- Settings (single row). Everything is OFF until someone turns it on.
-- ============================================================
create table if not exists public.trial_nudge_settings (
  id boolean primary key default true check (id),
  sending_enabled boolean not null default false,
  promotional_enabled boolean not null default false,
  updated_at timestamptz not null default now(),
  updated_by uuid references public.platform_team_members(id) on delete set null
);

comment on table public.trial_nudge_settings is
  'Single row. sending_enabled=false stops every trial nudge from being queued or sent; promotional_enabled=false additionally stops promotional ones. Both default OFF. Super-admin read only; written by admin_set_trial_nudge_settings().';

insert into public.trial_nudge_settings (id) values (true) on conflict (id) do nothing;

-- ============================================================
-- The queue
-- ============================================================
create table if not exists public.trial_nudges (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  school_id uuid not null references public.schools(id) on delete cascade,
  kind text not null check (kind in ('service', 'promotional')),
  recipient_email text not null check (recipient_email = lower(recipient_email)),
  recipient_name text,
  subject text not null check (char_length(btrim(subject)) between 1 and 200),
  body text not null check (char_length(btrim(body)) between 1 and 4000),
  payload_hash text not null,
  status text not null default 'proposed'
    check (status in ('proposed', 'approved', 'rejected', 'cancelled', 'expired', 'queued', 'sent', 'failed')),
  proposed_by uuid references public.platform_team_members(id) on delete set null,
  reviewed_by uuid references public.platform_team_members(id) on delete set null,
  reviewed_at timestamptz,
  review_note text check (review_note is null or char_length(review_note) <= 500),
  approved_hash text,
  campaign_id uuid references public.email_campaigns(id) on delete set null,
  queued_at timestamptz,
  sent_at timestamptz,
  error text check (error is null or char_length(error) <= 500),
  -- Once approved, the text on the row must still be the text that was approved.
  constraint trial_nudges_approved_matches check (
    status not in ('approved', 'queued', 'sent') or approved_hash = payload_hash
  )
);

comment on table public.trial_nudges is
  'Approval queue for emails to trial-school owners. proposed -> approved -> queued -> sent (or rejected / cancelled / expired / failed). Approval is bound to payload_hash (school, kind, recipient, subject, body). Sending reuses email_campaigns (one recipient, custom_subject/custom_body). Super-admin read only; writes via admin_*_trial_nudge() functions. Deleted with the school.';

create unique index if not exists trial_nudges_one_open_idx
  on public.trial_nudges (school_id) where status in ('proposed', 'approved');
create index if not exists trial_nudges_school_idx on public.trial_nudges (school_id, created_at desc);
create index if not exists trial_nudges_status_idx on public.trial_nudges (status, created_at desc);
create index if not exists trial_nudges_proposed_by_idx on public.trial_nudges (proposed_by) where proposed_by is not null;
create index if not exists trial_nudges_reviewed_by_idx on public.trial_nudges (reviewed_by) where reviewed_by is not null;
create index if not exists trial_nudges_campaign_idx on public.trial_nudges (campaign_id) where campaign_id is not null;

alter table public.trial_nudge_settings enable row level security;
alter table public.trial_nudges enable row level security;

revoke all on public.trial_nudge_settings from anon, authenticated;
revoke all on public.trial_nudges from anon, authenticated;
grant select on public.trial_nudge_settings to authenticated;
grant select on public.trial_nudges to authenticated;

drop policy if exists "trial_nudge_settings_select" on public.trial_nudge_settings;
create policy "trial_nudge_settings_select" on public.trial_nudge_settings
  for select to authenticated using (auth_is_super_admin());

drop policy if exists "trial_nudges_select" on public.trial_nudges;
create policy "trial_nudges_select" on public.trial_nudges
  for select to authenticated using (auth_is_super_admin());

-- ============================================================
-- Internal helpers (not callable by clients)
-- ============================================================

-- Hash of everything an approval covers. Changing any part changes the hash.
create or replace function public._trial_nudge_hash(p_school uuid, p_kind text, p_email text, p_subject text, p_body text)
returns text
language sql
immutable
set search_path to 'public'
as $$
  select encode(sha256(convert_to(
    p_school::text || E'\x1f' || p_kind || E'\x1f' || lower(p_email) || E'\x1f' || btrim(p_subject) || E'\x1f' || btrim(p_body),
    'UTF8')), 'hex')
$$;

-- The school's owner: earliest active school_owner with an email; same exclusions as the owner campaign audience.
create or replace function public._trial_nudge_recipient(p_school_id uuid)
returns table (email text, name text, school_name text)
language sql
stable
security definer
set search_path to 'public'
as $$
  select lower(su.email), su.full_name, s.name
  from public.school_users su
  join public.roles r on r.id = su.role_id and r.name = 'school_owner'
  join public.schools s on s.id = su.school_id
  where su.school_id = p_school_id
    and su.status = 'active'
    and su.email is not null
    and btrim(su.email) <> ''
    and s.slug <> 'demo-academy'
    and s.slug not like 'qa-%'
    and lower(su.email) not like '%@educore.test'
    and lower(su.email) not like '%.test'
  order by su.created_at, su.id
  limit 1
$$;

-- Returns a plain-language problem with the message text, or null when it is acceptable.
create or replace function public._trial_nudge_content_problem(p_kind text, p_subject text, p_body text)
returns text
language plpgsql
immutable
set search_path to 'public'
as $$
declare
  v text := lower(coalesce(p_subject, '') || E'\n' || coalesce(p_body, ''));
  phrase text;
  dom text[];
begin
  if p_kind is null or p_kind not in ('service', 'promotional') then
    return 'Choose service or promotional.';
  end if;
  if char_length(btrim(coalesce(p_subject, ''))) = 0 then return 'Subject is required.'; end if;
  if char_length(btrim(p_subject)) > 200 then return 'Subject is too long (max 200 characters).'; end if;
  if char_length(btrim(coalesce(p_body, ''))) = 0 then return 'Message is required.'; end if;
  if char_length(btrim(p_body)) > 4000 then return 'Message is too long (max 4000 characters).'; end if;

  -- Claims the product must not make.
  foreach phrase in array array[
    'no obligation', 'kicd approved', 'kicd-approved', 'approved by kicd', 'ministry approved',
    'ministry-approved', 'approved by the ministry', 'guaranteed', 'free forever'
  ] loop
    if position(phrase in v) > 0 then
      return 'Remove "' || phrase || '": EduCore does not make that claim.';
    end if;
  end loop;

  -- Only {{name}} and {{school}} are filled in at send time; anything else would go out as literal text.
  if regexp_replace(v, '\{\{\s*(name|school)\s*\}\}', '', 'g') ~ '(\{\{|\}\})' then
    return 'Only {{name}} and {{school}} can be used as placeholders.';
  end if;

  -- Links and addresses may only point at educoreafrica.com.
  for dom in
    select m from regexp_matches(
      v, '((?:[a-z0-9][a-z0-9-]*\.)+(?:com|co\.ke|or\.ke|ac\.ke|sc\.ke|org|net|io|app|me|ly|info|biz|xyz|link|ke))\M', 'g'
    ) as t(m)
  loop
    if dom[1] <> 'educoreafrica.com' and dom[1] not like '%.educoreafrica.com' then
      return 'Links and addresses may only point to educoreafrica.com (found "' || dom[1] || '").';
    end if;
  end loop;

  -- A "service" message must not read like an offer, or it would skip the stricter promotional gate.
  if p_kind = 'service'
     and v ~ '(\m(discount|discounted|promo|promotion|promotional|coupon|voucher|waive|waived)\M|% off|percent off|special offer|limited[- ]time|free month)' then
    return 'This reads like an offer. Send it as a promotional message instead.';
  end if;

  return null;
end;
$$;

-- Returns a plain-language reason this school cannot be messaged right now, or null when it can.
-- p_exclude is the nudge being checked, so it does not count against its own caps.
create or replace function public._trial_nudge_problem(p_school_id uuid, p_kind text, p_exclude uuid default null)
returns text
language plpgsql
stable
security definer
set search_path to 'public'
as $$
declare
  sc_slug text;
  sc_status text;
  sub_status text;
  sub_ends timestamptz;
  v_running boolean;
  v_ended boolean;
  v_email text;
  v_n integer;
begin
  select s.slug, s.status into sc_slug, sc_status from public.schools s where s.id = p_school_id;
  if not found then return 'School not found.'; end if;
  if sc_slug = 'demo-academy' or sc_slug like 'qa-%' then
    return 'Demo and test schools are never messaged.';
  end if;

  select ss.status, ss.trial_ends_at into sub_status, sub_ends from public.school_subscriptions ss where ss.school_id = p_school_id;
  if not found then return 'This school has no trial or subscription.'; end if;

  v_running := sc_status = 'trial' and sub_status = 'trialing';
  v_ended := sc_status = 'suspended' and sub_status in ('past_due', 'suspended')
             and sub_ends is not null and sub_ends >= now() - interval '14 days' and sub_ends <= now();
  if p_kind = 'service' and not v_running then
    return 'Service messages are only for trials that are running.';
  end if;
  if p_kind = 'promotional' and not (v_running or v_ended) then
    return 'Promotional messages are only for running trials or trials that ended in the last 14 days.';
  end if;

  select e.email into v_email from public._trial_nudge_recipient(p_school_id) e;
  if v_email is null then return 'This school has no active owner email on file.'; end if;
  if exists (select 1 from public.marketing_email_suppressions m where m.email = v_email) then
    return 'This address has unsubscribed from EduCore email.';
  end if;

  if exists (select 1 from public.trial_checkins c where c.school_id = p_school_id and c.outcome = 'asked_to_stop') then
    return 'This school asked not to be contacted.';
  end if;
  if p_kind = 'promotional'
     and exists (select 1 from public.trial_checkins c where c.school_id = p_school_id and c.outcome = 'reached_not_interested') then
    return 'This school said it is not interested, so promotional messages are blocked.';
  end if;

  select count(*)::integer into v_n from public.trial_nudges t
   where t.school_id = p_school_id and t.id is distinct from p_exclude
     and t.status in ('approved', 'queued', 'sent')
     and coalesce(t.sent_at, t.queued_at, t.reviewed_at, t.created_at) > now() - interval '3 days';
  if v_n > 0 then
    return 'This school was messaged, or has an approved message waiting, in the last 3 days.';
  end if;

  if p_kind = 'promotional' then
    select count(*)::integer into v_n from public.trial_nudges t
     where t.school_id = p_school_id and t.id is distinct from p_exclude and t.kind = 'promotional'
       and t.status in ('approved', 'queued', 'sent')
       and coalesce(t.sent_at, t.queued_at, t.reviewed_at, t.created_at) > now() - interval '30 days';
    if v_n >= 2 then
      return 'This school already has 2 promotional messages in the last 30 days.';
    end if;
  end if;

  return null;
end;
$$;

revoke all on function public._trial_nudge_hash(uuid, text, text, text, text) from public, anon, authenticated;
revoke all on function public._trial_nudge_recipient(uuid) from public, anon, authenticated;
revoke all on function public._trial_nudge_content_problem(text, text, text) from public, anon, authenticated;
revoke all on function public._trial_nudge_problem(uuid, text, uuid) from public, anon, authenticated;

-- ============================================================
-- Settings
-- ============================================================
create or replace function public.admin_get_trial_nudge_settings()
returns table (sending_enabled boolean, promotional_enabled boolean, updated_at timestamptz)
language plpgsql
stable
security definer
set search_path to 'public'
as $$
begin
  if not auth_is_super_admin() then
    raise exception 'Not authorized to manage trial messages.';
  end if;
  return query select s.sending_enabled, s.promotional_enabled, s.updated_at from public.trial_nudge_settings s;
end;
$$;

create or replace function public.admin_set_trial_nudge_settings(p_sending boolean, p_promotional boolean, p_updated_by uuid)
returns void
language plpgsql
security definer
set search_path to 'public'
as $$
begin
  if not auth_is_super_admin() then
    raise exception 'Not authorized to manage trial messages.';
  end if;
  if p_sending is null or p_promotional is null then
    raise exception 'Both switches are required.';
  end if;
  if p_updated_by is null or not exists (select 1 from public.platform_team_members where id = p_updated_by) then
    raise exception 'Say who you are before changing these switches.';
  end if;
  update public.trial_nudge_settings
     set sending_enabled = p_sending, promotional_enabled = p_promotional, updated_at = now(), updated_by = p_updated_by
   where id;
end;
$$;

-- ============================================================
-- Propose / edit / review / withdraw
-- ============================================================
create or replace function public.admin_propose_trial_nudge(
  p_school_id uuid, p_kind text, p_subject text, p_body text, p_proposed_by uuid
)
returns uuid
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_problem text;
  v_email text;
  v_name text;
  v_id uuid;
begin
  if not auth_is_super_admin() then
    raise exception 'Not authorized to manage trial messages.';
  end if;
  if p_proposed_by is null or not exists (select 1 from public.platform_team_members where id = p_proposed_by) then
    raise exception 'Say who is proposing this message.';
  end if;

  v_problem := public._trial_nudge_content_problem(p_kind, p_subject, p_body);
  if v_problem is not null then raise exception '%', v_problem; end if;
  if exists (select 1 from public.trial_nudges where school_id = p_school_id and status in ('proposed', 'approved')) then
    raise exception 'This school already has a message waiting to be reviewed or sent.';
  end if;
  v_problem := public._trial_nudge_problem(p_school_id, p_kind, null);
  if v_problem is not null then raise exception '%', v_problem; end if;

  select e.email, e.name into v_email, v_name from public._trial_nudge_recipient(p_school_id) e;

  insert into public.trial_nudges (school_id, kind, recipient_email, recipient_name, subject, body, payload_hash, proposed_by)
  values (p_school_id, p_kind, v_email, v_name, btrim(p_subject), btrim(p_body),
          public._trial_nudge_hash(p_school_id, p_kind, v_email, p_subject, p_body), p_proposed_by)
  returning id into v_id;
  return v_id;
end;
$$;

create or replace function public.admin_edit_trial_nudge(p_id uuid, p_subject text, p_body text)
returns void
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  n public.trial_nudges%rowtype;
  v_problem text;
  v_email text;
  v_name text;
begin
  if not auth_is_super_admin() then
    raise exception 'Not authorized to manage trial messages.';
  end if;
  select * into n from public.trial_nudges where id = p_id for update;
  if not found then raise exception 'Message not found.'; end if;
  if n.status <> 'proposed' then
    raise exception 'Only a message that has not been approved can be edited. Withdraw it and propose a new one.';
  end if;

  v_problem := public._trial_nudge_content_problem(n.kind, p_subject, p_body);
  if v_problem is not null then raise exception '%', v_problem; end if;
  v_problem := public._trial_nudge_problem(n.school_id, n.kind, n.id);
  if v_problem is not null then raise exception '%', v_problem; end if;

  select e.email, e.name into v_email, v_name from public._trial_nudge_recipient(n.school_id) e;
  update public.trial_nudges
     set subject = btrim(p_subject), body = btrim(p_body), recipient_email = v_email, recipient_name = v_name,
         payload_hash = public._trial_nudge_hash(n.school_id, n.kind, v_email, p_subject, p_body), updated_at = now()
   where id = p_id;
end;
$$;

-- Approve or reject a proposed message. Returns the resulting status ('approved', 'rejected' or 'expired').
-- To approve, the caller must pass the hash of the text they were shown.
create or replace function public.admin_review_trial_nudge(
  p_id uuid, p_decision text, p_expected_hash text, p_reviewed_by uuid, p_note text default null
)
returns text
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  n public.trial_nudges%rowtype;
  v_problem text;
  v_email text;
  v_note text := nullif(btrim(p_note), '');
begin
  if not auth_is_super_admin() then
    raise exception 'Not authorized to manage trial messages.';
  end if;
  if p_decision not in ('approve', 'reject') then
    raise exception 'Decision must be approve or reject.';
  end if;
  if p_reviewed_by is null or not exists (select 1 from public.platform_team_members where id = p_reviewed_by) then
    raise exception 'Say who is reviewing this message.';
  end if;
  if v_note is not null and char_length(v_note) > 500 then
    raise exception 'Note is too long (max 500 characters).';
  end if;

  select * into n from public.trial_nudges where id = p_id for update;
  if not found then raise exception 'Message not found.'; end if;

  -- Repeating the same decision is a no-op.
  if p_decision = 'approve' and n.status = 'approved' and n.approved_hash = p_expected_hash then return 'approved'; end if;
  if p_decision = 'reject' and n.status = 'rejected' then return 'rejected'; end if;
  if n.status <> 'proposed' then
    raise exception 'This message is already %.', n.status;
  end if;

  if n.created_at < now() - interval '7 days' then
    update public.trial_nudges set status = 'expired', updated_at = now() where id = p_id;
    return 'expired';
  end if;

  if p_decision = 'reject' then
    update public.trial_nudges
       set status = 'rejected', reviewed_by = p_reviewed_by, reviewed_at = now(), review_note = v_note, updated_at = now()
     where id = p_id;
    return 'rejected';
  end if;

  if p_expected_hash is distinct from n.payload_hash then
    raise exception 'This message changed since you opened it. Reload and review it again.';
  end if;
  select e.email into v_email from public._trial_nudge_recipient(n.school_id) e;
  if v_email is distinct from n.recipient_email
     or public._trial_nudge_hash(n.school_id, n.kind, coalesce(v_email, ''), n.subject, n.body) <> n.payload_hash then
    raise exception 'The recipient changed since this was proposed. Withdraw it and propose it again.';
  end if;
  v_problem := public._trial_nudge_content_problem(n.kind, n.subject, n.body);
  if v_problem is not null then raise exception '%', v_problem; end if;
  v_problem := public._trial_nudge_problem(n.school_id, n.kind, n.id);
  if v_problem is not null then raise exception '%', v_problem; end if;

  update public.trial_nudges
     set status = 'approved', approved_hash = payload_hash, reviewed_by = p_reviewed_by, reviewed_at = now(),
         review_note = v_note, updated_at = now()
   where id = p_id;
  return 'approved';
end;
$$;

-- Withdraw a message that has not been queued yet.
create or replace function public.admin_withdraw_trial_nudge(p_id uuid)
returns void
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  n public.trial_nudges%rowtype;
begin
  if not auth_is_super_admin() then
    raise exception 'Not authorized to manage trial messages.';
  end if;
  select * into n from public.trial_nudges where id = p_id for update;
  if not found then raise exception 'Message not found.'; end if;
  if n.status = 'cancelled' then return; end if;
  if n.status not in ('proposed', 'approved') then
    raise exception 'A message that is already % cannot be withdrawn.', n.status;
  end if;
  update public.trial_nudges set status = 'cancelled', updated_at = now() where id = p_id;
end;
$$;

-- ============================================================
-- Send: queue (hand to the campaign pipeline) then finalize (read back the result)
-- ============================================================

-- Re-checks everything, then creates the one-recipient campaign. Returns {ok, campaign_id, message}.
-- A refusal is returned (not raised) so that an expiry it records is kept.
create or replace function public.admin_queue_trial_nudge(p_id uuid)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  n public.trial_nudges%rowtype;
  st public.trial_nudge_settings%rowtype;
  v_problem text;
  v_email text;
  v_name text;
  v_school text;
  v_campaign uuid;
begin
  if not auth_is_super_admin() then
    raise exception 'Not authorized to manage trial messages.';
  end if;
  select * into n from public.trial_nudges where id = p_id for update;
  if not found then raise exception 'Message not found.'; end if;

  if n.status = 'queued' then
    return jsonb_build_object('ok', true, 'campaign_id', n.campaign_id, 'already_queued', true);
  end if;
  if n.status <> 'approved' then
    return jsonb_build_object('ok', false, 'message', 'Only an approved message can be sent (this one is ' || n.status || ').');
  end if;

  select * into st from public.trial_nudge_settings where id;
  if not coalesce(st.sending_enabled, false) then
    return jsonb_build_object('ok', false, 'message', 'Sending trial messages is switched off.');
  end if;
  if n.kind = 'promotional' and not coalesce(st.promotional_enabled, false) then
    return jsonb_build_object('ok', false, 'message', 'Promotional trial messages are switched off.');
  end if;

  if n.reviewed_at < now() - interval '24 hours' then
    update public.trial_nudges set status = 'expired', updated_at = now() where id = p_id;
    return jsonb_build_object('ok', false, 'message', 'The approval expired after 24 hours. Propose the message again.');
  end if;

  select e.email, e.name, e.school_name into v_email, v_name, v_school from public._trial_nudge_recipient(n.school_id) e;
  if v_email is distinct from n.recipient_email then
    return jsonb_build_object('ok', false, 'message', 'The recipient changed since approval. Withdraw it and propose it again.');
  end if;
  if public._trial_nudge_hash(n.school_id, n.kind, v_email, n.subject, n.body) is distinct from n.approved_hash then
    return jsonb_build_object('ok', false, 'message', 'The message no longer matches what was approved.');
  end if;

  v_problem := public._trial_nudge_content_problem(n.kind, n.subject, n.body);
  if v_problem is null then v_problem := public._trial_nudge_problem(n.school_id, n.kind, n.id); end if;
  if v_problem is not null then
    return jsonb_build_object('ok', false, 'message', v_problem);
  end if;

  if (select count(*) from public.trial_nudges t
       where t.status in ('queued', 'sent') and coalesce(t.sent_at, t.queued_at) > now() - interval '24 hours') >= 30 then
    return jsonb_build_object('ok', false, 'message', 'Daily limit reached: at most 30 trial messages in 24 hours.');
  end if;

  insert into public.email_campaigns (subject, body, audience, created_by)
  values (left('Trial message: ' || coalesce(v_school, 'school'), 200), n.body, 'school_owners', auth.uid())
  returning id into v_campaign;

  insert into public.email_campaign_recipients (campaign_id, school_id, school_name, recipient_name, email, custom_subject, custom_body)
  values (v_campaign, n.school_id, v_school, v_name, v_email, n.subject, n.body);

  update public.trial_nudges
     set status = 'queued', campaign_id = v_campaign, queued_at = now(), updated_at = now()
   where id = p_id;

  return jsonb_build_object('ok', true, 'campaign_id', v_campaign);
end;
$$;

-- Reads the campaign recipient back and records the outcome. Returns the nudge's status.
-- On success it also records an email check-in so the Trial follow-up page does not suggest the school again.
create or replace function public.admin_finalize_trial_nudge(p_id uuid)
returns text
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  n public.trial_nudges%rowtype;
  r_status text;
  r_error text;
  r_sent timestamptz;
begin
  if not auth_is_super_admin() then
    raise exception 'Not authorized to manage trial messages.';
  end if;
  select * into n from public.trial_nudges where id = p_id for update;
  if not found then raise exception 'Message not found.'; end if;
  if n.status <> 'queued' then return n.status; end if;

  select r.status, r.error, r.sent_at into r_status, r_error, r_sent
    from public.email_campaign_recipients r where r.campaign_id = n.campaign_id order by r.created_at limit 1;
  if not found then
    update public.trial_nudges set status = 'failed', error = 'The send record is missing.', updated_at = now() where id = p_id;
    return 'failed';
  end if;

  if r_status = 'sent' then
    update public.trial_nudges set status = 'sent', sent_at = coalesce(r_sent, now()), updated_at = now() where id = p_id;
    insert into public.trial_checkins (school_id, channel, outcome, note)
    values (n.school_id, 'email', 'message_left', 'Trial message emailed (' || n.kind || ')');
    return 'sent';
  elsif r_status = 'failed' then
    update public.trial_nudges set status = 'failed', error = left(coalesce(r_error, 'Send failed.'), 500), updated_at = now() where id = p_id;
    return 'failed';
  elsif r_status = 'skipped_unsubscribed' then
    update public.trial_nudges set status = 'failed', error = 'The owner unsubscribed before this was sent.', updated_at = now() where id = p_id;
    return 'failed';
  end if;
  return 'queued';
end;
$$;

revoke all on function public.admin_get_trial_nudge_settings() from public, anon;
revoke all on function public.admin_set_trial_nudge_settings(boolean, boolean, uuid) from public, anon;
revoke all on function public.admin_propose_trial_nudge(uuid, text, text, text, uuid) from public, anon;
revoke all on function public.admin_edit_trial_nudge(uuid, text, text) from public, anon;
revoke all on function public.admin_review_trial_nudge(uuid, text, text, uuid, text) from public, anon;
revoke all on function public.admin_withdraw_trial_nudge(uuid) from public, anon;
revoke all on function public.admin_queue_trial_nudge(uuid) from public, anon;
revoke all on function public.admin_finalize_trial_nudge(uuid) from public, anon;
grant execute on function public.admin_get_trial_nudge_settings() to authenticated;
grant execute on function public.admin_set_trial_nudge_settings(boolean, boolean, uuid) to authenticated;
grant execute on function public.admin_propose_trial_nudge(uuid, text, text, text, uuid) to authenticated;
grant execute on function public.admin_edit_trial_nudge(uuid, text, text) to authenticated;
grant execute on function public.admin_review_trial_nudge(uuid, text, text, uuid, text) to authenticated;
grant execute on function public.admin_withdraw_trial_nudge(uuid) to authenticated;
grant execute on function public.admin_queue_trial_nudge(uuid) to authenticated;
grant execute on function public.admin_finalize_trial_nudge(uuid) to authenticated;
