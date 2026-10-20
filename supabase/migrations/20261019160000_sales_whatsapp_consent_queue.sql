-- Sales WhatsApp, first PR (Growth Engine, Phase 2 item B): a consent register and an approval queue.
--
-- NO provider is involved yet. Nothing in this migration sends a WhatsApp message. An approved message is sent by a
-- PERSON from their own WhatsApp (the page opens WhatsApp with the text filled in) and then marked as sent here.
-- The Twilio send path and reply/STOP handling come in a second PR, once the sales sender number and approved
-- message templates exist.
--
-- Who may be messaged: only people who agreed, and only for what they agreed to.
--  * demo_form: the public /contact form has an unticked-by-default WhatsApp tick-box. The exact words shown are
--    stored with the agreement. That wording covers messages about the demo request and trial only (scope 'service').
--  * team_recorded: a team member records that someone agreed (on a call, in person, by WhatsApp reply, by email),
--    and chooses whether it also covers promotional messages (scope 'service_and_promotional').
--  Withdrawing an agreement cancels any open message and records a permanent WhatsApp opt-out
--  (prospect_channel_opt_outs, the same register outreach uses), so the number is blocked everywhere.
--
-- Additive: three new tables and new functions. Nothing existing is altered, dropped or backfilled.
-- Needs 20261017150000_outbound_contact_log_and_opt_outs.sql (opt-out register + number normaliser),
-- 20261018220000_trial_nudges.sql (the shared content rules), 20260828203537_marketing_demo_requests.sql.
--
-- Rules enforced here (propose, approve and mark-sent each re-check them; the UI only mirrors them):
--  * Active agreement required; number not in the WhatsApp opt-out register.
--  * Promotional only with a service_and_promotional agreement, and only while the promotional switch is on
--    (OFF by default; contacting people for marketing under Kenya's Data Protection Act is a separate legal decision).
--  * One open (proposed or approved) message per person; at most one message per person in 2 days; at most 2
--    promotional per person in 30 days; at most 40 marked sent platform-wide per 24 hours.
--  * Approval is bound to the exact text (hash of person + number + kind + text); approved text cannot be edited;
--    an approval is valid for 24 hours and a proposal for 7 days.
--  * Content: the same claim / link rules as trial nudges (no "no obligation", no KICD/Ministry approval claims,
--    links only to educoreafrica.com, offers cannot pass as service), at most 1000 characters, and no {{placeholders}}
--    (a person sends the text as written, so nothing would fill them in).
--  * Access: super admin read only; every admin write is a SECURITY DEFINER function that checks auth_is_super_admin().
--    The one public path (recording the demo-form agreement) is executable by service_role only.

-- ============================================================
-- Consent register
-- ============================================================
create table if not exists public.whatsapp_consents (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  -- Normalised by _normalize_contact_identifier: digits only, Kenyan numbers as 254XXXXXXXXX.
  phone text not null check (phone ~ '^[0-9]{9,15}$'),
  contact_name text not null check (char_length(btrim(contact_name)) between 1 and 120),
  school_name text check (school_name is null or char_length(school_name) <= 200),
  source text not null check (source in ('demo_form', 'team_recorded')),
  scope text not null default 'service' check (scope in ('service', 'service_and_promotional')),
  -- The exact words the person agreed to (form label), or how a team member says they agreed.
  consent_text text not null check (char_length(btrim(consent_text)) between 1 and 600),
  how text check (how is null or how in ('call', 'in_person', 'whatsapp_reply', 'email', 'other')),
  demo_request_id uuid references public.marketing_demo_requests(id) on delete set null,
  school_id uuid references public.schools(id) on delete set null,
  recorded_by uuid references public.platform_team_members(id) on delete set null,
  note text check (note is null or char_length(note) <= 500),
  withdrawn_at timestamptz,
  withdrawn_by uuid references public.platform_team_members(id) on delete set null
);

comment on table public.whatsapp_consents is
  'Who agreed to be contacted on WhatsApp, when, the exact words, and the scope (service = about their demo/trial only; service_and_promotional also covers offers). One ACTIVE row per number. Withdrawing also writes a permanent WhatsApp opt-out. Super-admin read only; writes via record_demo_whatsapp_consent (service_role only) and admin_*_whatsapp_consent().';

create unique index if not exists whatsapp_consents_one_active_idx on public.whatsapp_consents (phone) where withdrawn_at is null;
create index if not exists whatsapp_consents_created_idx on public.whatsapp_consents (created_at desc);
create index if not exists whatsapp_consents_demo_request_idx on public.whatsapp_consents (demo_request_id) where demo_request_id is not null;
create index if not exists whatsapp_consents_school_idx on public.whatsapp_consents (school_id) where school_id is not null;
create index if not exists whatsapp_consents_recorded_by_idx on public.whatsapp_consents (recorded_by) where recorded_by is not null;
create index if not exists whatsapp_consents_withdrawn_by_idx on public.whatsapp_consents (withdrawn_by) where withdrawn_by is not null;

-- ============================================================
-- Queue
-- ============================================================
create table if not exists public.sales_whatsapp_messages (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  consent_id uuid not null references public.whatsapp_consents(id) on delete cascade,
  phone text not null check (phone ~ '^[0-9]{9,15}$'),
  recipient_name text not null,
  kind text not null check (kind in ('service', 'promotional')),
  body text not null check (char_length(btrim(body)) between 1 and 1000),
  payload_hash text not null,
  status text not null default 'proposed'
    check (status in ('proposed', 'approved', 'rejected', 'cancelled', 'expired', 'sent')),
  proposed_by uuid references public.platform_team_members(id) on delete set null,
  reviewed_by uuid references public.platform_team_members(id) on delete set null,
  reviewed_at timestamptz,
  review_note text check (review_note is null or char_length(review_note) <= 500),
  approved_hash text,
  sent_at timestamptz,
  sent_by uuid references public.platform_team_members(id) on delete set null,
  -- 'manual' = a person sent it from their own WhatsApp. The Twilio PR adds 'twilio'.
  send_method text check (send_method is null or send_method in ('manual')),
  constraint sales_whatsapp_messages_approved_matches check (
    status not in ('approved', 'sent') or approved_hash = payload_hash
  )
);

comment on table public.sales_whatsapp_messages is
  'Approval queue for sales WhatsApp messages. proposed -> approved -> sent (marked by the person who sent it), or rejected / cancelled / expired. Approval is bound to payload_hash. Nothing is sent by the system in this version. Super-admin read only; writes via admin_*_sales_whatsapp() functions.';

create unique index if not exists sales_whatsapp_messages_one_open_idx
  on public.sales_whatsapp_messages (consent_id) where status in ('proposed', 'approved');
create index if not exists sales_whatsapp_messages_consent_idx on public.sales_whatsapp_messages (consent_id, created_at desc);
create index if not exists sales_whatsapp_messages_status_idx on public.sales_whatsapp_messages (status, created_at desc);
create index if not exists sales_whatsapp_messages_proposed_by_idx on public.sales_whatsapp_messages (proposed_by) where proposed_by is not null;
create index if not exists sales_whatsapp_messages_reviewed_by_idx on public.sales_whatsapp_messages (reviewed_by) where reviewed_by is not null;
create index if not exists sales_whatsapp_messages_sent_by_idx on public.sales_whatsapp_messages (sent_by) where sent_by is not null;

-- ============================================================
-- Settings (single row)
-- ============================================================
create table if not exists public.sales_whatsapp_settings (
  id boolean primary key default true check (id),
  promotional_enabled boolean not null default false,
  updated_at timestamptz not null default now(),
  updated_by uuid references public.platform_team_members(id) on delete set null
);

comment on table public.sales_whatsapp_settings is
  'Single row. promotional_enabled=false (the default) stops promotional WhatsApp messages from being approved or marked sent. Super-admin read only; written by admin_set_sales_whatsapp_settings().';

insert into public.sales_whatsapp_settings (id) values (true) on conflict (id) do nothing;

alter table public.whatsapp_consents enable row level security;
alter table public.sales_whatsapp_messages enable row level security;
alter table public.sales_whatsapp_settings enable row level security;

revoke all on public.whatsapp_consents from anon, authenticated;
revoke all on public.sales_whatsapp_messages from anon, authenticated;
revoke all on public.sales_whatsapp_settings from anon, authenticated;
grant select on public.whatsapp_consents to authenticated;
grant select on public.sales_whatsapp_messages to authenticated;
grant select on public.sales_whatsapp_settings to authenticated;

drop policy if exists "whatsapp_consents_select" on public.whatsapp_consents;
create policy "whatsapp_consents_select" on public.whatsapp_consents for select to authenticated using (auth_is_super_admin());
drop policy if exists "sales_whatsapp_messages_select" on public.sales_whatsapp_messages;
create policy "sales_whatsapp_messages_select" on public.sales_whatsapp_messages for select to authenticated using (auth_is_super_admin());
drop policy if exists "sales_whatsapp_settings_select" on public.sales_whatsapp_settings;
create policy "sales_whatsapp_settings_select" on public.sales_whatsapp_settings for select to authenticated using (auth_is_super_admin());

-- ============================================================
-- Internal helpers
-- ============================================================
create or replace function public._sales_wa_hash(p_consent uuid, p_phone text, p_kind text, p_body text)
returns text
language sql
immutable
set search_path to 'public'
as $$
  select encode(sha256(convert_to(p_consent::text || E'\x1f' || p_phone || E'\x1f' || p_kind || E'\x1f' || btrim(p_body), 'UTF8')), 'hex')
$$;

-- Plain-language problem with the text, or null. Reuses the trial-nudge claim/link/offer rules.
create or replace function public._sales_wa_content_problem(p_kind text, p_body text)
returns text
language plpgsql
immutable
set search_path to 'public'
as $$
begin
  if char_length(btrim(coalesce(p_body, ''))) > 1000 then
    return 'Message is too long (max 1000 characters).';
  end if;
  if coalesce(p_body, '') ~ '(\{\{|\}\})' then
    return 'Write the person''s name directly: placeholders are not filled in for WhatsApp messages.';
  end if;
  return public._trial_nudge_content_problem(p_kind, 'WhatsApp message', p_body);
end;
$$;

-- Reason this person cannot be messaged now, or null. p_exclude is the message being checked.
create or replace function public._sales_wa_problem(p_consent_id uuid, p_kind text, p_exclude uuid default null)
returns text
language plpgsql
stable
security definer
set search_path to 'public'
as $$
declare
  c public.whatsapp_consents%rowtype;
  v_n integer;
begin
  select * into c from public.whatsapp_consents where id = p_consent_id;
  if not found then return 'Agreement record not found.'; end if;
  if c.withdrawn_at is not null then return 'This person withdrew their agreement to WhatsApp messages.'; end if;
  if exists (select 1 from public.prospect_channel_opt_outs o where o.channel = 'whatsapp' and o.identifier = c.phone) then
    return 'This number has opted out of WhatsApp messages.';
  end if;
  if p_kind = 'promotional' and c.scope <> 'service_and_promotional' then
    return 'This person agreed to messages about their demo and trial only, not promotional ones.';
  end if;

  select count(*)::integer into v_n from public.sales_whatsapp_messages m
   where m.consent_id = p_consent_id and m.id is distinct from p_exclude and m.status in ('approved', 'sent')
     and coalesce(m.sent_at, m.reviewed_at, m.created_at) > now() - interval '2 days';
  if v_n > 0 then
    return 'This person was messaged, or has an approved message waiting, in the last 2 days.';
  end if;

  if p_kind = 'promotional' then
    select count(*)::integer into v_n from public.sales_whatsapp_messages m
     where m.consent_id = p_consent_id and m.id is distinct from p_exclude and m.kind = 'promotional' and m.status in ('approved', 'sent')
       and coalesce(m.sent_at, m.reviewed_at, m.created_at) > now() - interval '30 days';
    if v_n >= 2 then return 'This person already has 2 promotional messages in the last 30 days.'; end if;
  end if;
  return null;
end;
$$;

revoke all on function public._sales_wa_hash(uuid, text, text, text) from public, anon, authenticated;
revoke all on function public._sales_wa_content_problem(text, text) from public, anon, authenticated;
revoke all on function public._sales_wa_problem(uuid, text, uuid) from public, anon, authenticated;

-- ============================================================
-- Recording agreement
-- ============================================================

-- Public path: called by the /contact server action (service role) after a demo request was saved with the
-- WhatsApp tick-box ticked. Returns the agreement id, or null when nothing was recorded (unusable number,
-- number already opted out, empty wording). Never raises for bad input: the lead itself must not be lost.
create or replace function public.record_demo_whatsapp_consent(
  p_demo_request_id uuid, p_name text, p_school_name text, p_phone text, p_consent_text text
)
returns uuid
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_phone text := public._normalize_contact_identifier('whatsapp', p_phone);
  v_text text := btrim(coalesce(p_consent_text, ''));
  v_name text := btrim(coalesce(p_name, ''));
  v_id uuid;
begin
  if v_phone is null or v_text = '' or v_name = '' or char_length(v_text) > 600 or char_length(v_name) > 120 then
    return null;
  end if;
  if exists (select 1 from public.prospect_channel_opt_outs o where o.channel = 'whatsapp' and o.identifier = v_phone) then
    return null;
  end if;
  select id into v_id from public.whatsapp_consents where phone = v_phone and withdrawn_at is null;
  if v_id is not null then
    return v_id;
  end if;
  insert into public.whatsapp_consents (phone, contact_name, school_name, source, scope, consent_text, demo_request_id)
  values (v_phone, v_name, nullif(left(btrim(coalesce(p_school_name, '')), 200), ''), 'demo_form', 'service', v_text,
          (select d.id from public.marketing_demo_requests d where d.id = p_demo_request_id))
  returning id into v_id;
  return v_id;
end;
$$;

revoke all on function public.record_demo_whatsapp_consent(uuid, text, text, text, text) from public, anon, authenticated;
grant execute on function public.record_demo_whatsapp_consent(uuid, text, text, text, text) to service_role;

-- A team member records that someone agreed (e.g. a trial-school owner on a call).
create or replace function public.admin_record_whatsapp_consent(
  p_phone text, p_name text, p_school_name text, p_how text, p_scope text,
  p_note text, p_school_id uuid, p_recorded_by uuid
)
returns uuid
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_phone text := public._normalize_contact_identifier('whatsapp', p_phone);
  v_name text := btrim(coalesce(p_name, ''));
  v_note text := nullif(btrim(p_note), '');
  v_id uuid;
begin
  if not auth_is_super_admin() then
    raise exception 'Not authorized to manage WhatsApp messages.';
  end if;
  if p_recorded_by is null or not exists (select 1 from public.platform_team_members where id = p_recorded_by) then
    raise exception 'Say who is recording this agreement.';
  end if;
  if v_phone is null then raise exception 'That is not a usable phone number.'; end if;
  if v_name = '' or char_length(v_name) > 120 then raise exception 'Enter the person''s name (max 120 characters).'; end if;
  if p_how is null or p_how not in ('call', 'in_person', 'whatsapp_reply', 'email', 'other') then
    raise exception 'Say how they agreed.';
  end if;
  if p_scope is null or p_scope not in ('service', 'service_and_promotional') then
    raise exception 'Choose what they agreed to.';
  end if;
  if v_note is not null and char_length(v_note) > 500 then raise exception 'Note is too long (max 500 characters).'; end if;
  if p_school_id is not null and not exists (select 1 from public.schools where id = p_school_id) then
    raise exception 'School not found.';
  end if;
  if exists (select 1 from public.prospect_channel_opt_outs o where o.channel = 'whatsapp' and o.identifier = v_phone) then
    raise exception 'This number has opted out of WhatsApp messages and cannot be added again.';
  end if;

  select id into v_id from public.whatsapp_consents where phone = v_phone and withdrawn_at is null;
  if v_id is not null then
    raise exception 'This number already has an active agreement.';
  end if;

  insert into public.whatsapp_consents (phone, contact_name, school_name, source, scope, consent_text, how, school_id, recorded_by, note)
  values (v_phone, v_name, nullif(left(btrim(coalesce(p_school_name, '')), 200), ''), 'team_recorded', p_scope,
          'Agreed to be contacted on WhatsApp (' || replace(p_how, '_', ' ') || '); recorded by a team member.',
          p_how, p_school_id, p_recorded_by, v_note)
  returning id into v_id;
  return v_id;
end;
$$;

-- Withdraw an agreement: cancels open messages and writes a permanent WhatsApp opt-out. Idempotent.
create or replace function public.admin_withdraw_whatsapp_consent(p_consent_id uuid, p_withdrawn_by uuid, p_note text default null)
returns void
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  c public.whatsapp_consents%rowtype;
  v_note text := nullif(btrim(p_note), '');
begin
  if not auth_is_super_admin() then
    raise exception 'Not authorized to manage WhatsApp messages.';
  end if;
  if p_withdrawn_by is null or not exists (select 1 from public.platform_team_members where id = p_withdrawn_by) then
    raise exception 'Say who is withdrawing this agreement.';
  end if;
  if v_note is not null and char_length(v_note) > 500 then raise exception 'Note is too long (max 500 characters).'; end if;

  select * into c from public.whatsapp_consents where id = p_consent_id for update;
  if not found then raise exception 'Agreement record not found.'; end if;
  if c.withdrawn_at is not null then return; end if;

  update public.whatsapp_consents set withdrawn_at = now(), withdrawn_by = p_withdrawn_by where id = p_consent_id;
  update public.sales_whatsapp_messages set status = 'cancelled', updated_at = now()
   where consent_id = p_consent_id and status in ('proposed', 'approved');
  perform public.admin_record_outbound_opt_out('whatsapp', c.phone, 'requested', coalesce(v_note, 'Agreement withdrawn on the WhatsApp page.'));
end;
$$;

-- ============================================================
-- Settings
-- ============================================================
create or replace function public.admin_get_sales_whatsapp_settings()
returns table (promotional_enabled boolean, updated_at timestamptz)
language plpgsql
stable
security definer
set search_path to 'public'
as $$
begin
  if not auth_is_super_admin() then
    raise exception 'Not authorized to manage WhatsApp messages.';
  end if;
  return query select s.promotional_enabled, s.updated_at from public.sales_whatsapp_settings s;
end;
$$;

create or replace function public.admin_set_sales_whatsapp_settings(p_promotional boolean, p_updated_by uuid)
returns void
language plpgsql
security definer
set search_path to 'public'
as $$
begin
  if not auth_is_super_admin() then
    raise exception 'Not authorized to manage WhatsApp messages.';
  end if;
  if p_promotional is null then raise exception 'The switch value is required.'; end if;
  if p_updated_by is null or not exists (select 1 from public.platform_team_members where id = p_updated_by) then
    raise exception 'Say who you are before changing this switch.';
  end if;
  update public.sales_whatsapp_settings set promotional_enabled = p_promotional, updated_at = now(), updated_by = p_updated_by where id;
end;
$$;

-- ============================================================
-- Propose / edit / review / withdraw
-- ============================================================
create or replace function public.admin_propose_sales_whatsapp(p_consent_id uuid, p_kind text, p_body text, p_proposed_by uuid)
returns uuid
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  c public.whatsapp_consents%rowtype;
  v_problem text;
  v_id uuid;
begin
  if not auth_is_super_admin() then
    raise exception 'Not authorized to manage WhatsApp messages.';
  end if;
  if p_proposed_by is null or not exists (select 1 from public.platform_team_members where id = p_proposed_by) then
    raise exception 'Say who is proposing this message.';
  end if;
  v_problem := public._sales_wa_content_problem(p_kind, p_body);
  if v_problem is not null then raise exception '%', v_problem; end if;

  select * into c from public.whatsapp_consents where id = p_consent_id;
  if not found then raise exception 'Agreement record not found.'; end if;
  if exists (select 1 from public.sales_whatsapp_messages where consent_id = p_consent_id and status in ('proposed', 'approved')) then
    raise exception 'This person already has a message waiting to be reviewed or sent.';
  end if;
  v_problem := public._sales_wa_problem(p_consent_id, p_kind, null);
  if v_problem is not null then raise exception '%', v_problem; end if;

  insert into public.sales_whatsapp_messages (consent_id, phone, recipient_name, kind, body, payload_hash, proposed_by)
  values (p_consent_id, c.phone, c.contact_name, p_kind, btrim(p_body),
          public._sales_wa_hash(p_consent_id, c.phone, p_kind, p_body), p_proposed_by)
  returning id into v_id;
  return v_id;
end;
$$;

create or replace function public.admin_edit_sales_whatsapp(p_id uuid, p_body text)
returns void
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  m public.sales_whatsapp_messages%rowtype;
  v_problem text;
begin
  if not auth_is_super_admin() then
    raise exception 'Not authorized to manage WhatsApp messages.';
  end if;
  select * into m from public.sales_whatsapp_messages where id = p_id for update;
  if not found then raise exception 'Message not found.'; end if;
  if m.status <> 'proposed' then
    raise exception 'Only a message that has not been approved can be edited. Withdraw it and propose a new one.';
  end if;
  v_problem := public._sales_wa_content_problem(m.kind, p_body);
  if v_problem is not null then raise exception '%', v_problem; end if;
  v_problem := public._sales_wa_problem(m.consent_id, m.kind, m.id);
  if v_problem is not null then raise exception '%', v_problem; end if;

  update public.sales_whatsapp_messages
     set body = btrim(p_body), payload_hash = public._sales_wa_hash(m.consent_id, m.phone, m.kind, p_body), updated_at = now()
   where id = p_id;
end;
$$;

-- Approve or reject. Returns the resulting status ('approved', 'rejected' or 'expired').
create or replace function public.admin_review_sales_whatsapp(
  p_id uuid, p_decision text, p_expected_hash text, p_reviewed_by uuid, p_note text default null
)
returns text
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  m public.sales_whatsapp_messages%rowtype;
  v_problem text;
  v_note text := nullif(btrim(p_note), '');
begin
  if not auth_is_super_admin() then
    raise exception 'Not authorized to manage WhatsApp messages.';
  end if;
  if p_decision not in ('approve', 'reject') then raise exception 'Decision must be approve or reject.'; end if;
  if p_reviewed_by is null or not exists (select 1 from public.platform_team_members where id = p_reviewed_by) then
    raise exception 'Say who is reviewing this message.';
  end if;
  if v_note is not null and char_length(v_note) > 500 then raise exception 'Note is too long (max 500 characters).'; end if;

  select * into m from public.sales_whatsapp_messages where id = p_id for update;
  if not found then raise exception 'Message not found.'; end if;

  if p_decision = 'approve' and m.status = 'approved' and m.approved_hash = p_expected_hash then return 'approved'; end if;
  if p_decision = 'reject' and m.status = 'rejected' then return 'rejected'; end if;
  if m.status <> 'proposed' then raise exception 'This message is already %.', m.status; end if;

  if m.created_at < now() - interval '7 days' then
    update public.sales_whatsapp_messages set status = 'expired', updated_at = now() where id = p_id;
    return 'expired';
  end if;

  if p_decision = 'reject' then
    update public.sales_whatsapp_messages
       set status = 'rejected', reviewed_by = p_reviewed_by, reviewed_at = now(), review_note = v_note, updated_at = now()
     where id = p_id;
    return 'rejected';
  end if;

  if p_expected_hash is distinct from m.payload_hash then
    raise exception 'This message changed since you opened it. Reload and review it again.';
  end if;
  if public._sales_wa_hash(m.consent_id, m.phone, m.kind, m.body) <> m.payload_hash then
    raise exception 'The message no longer matches what was proposed. Withdraw it and propose it again.';
  end if;
  if m.kind = 'promotional' and not coalesce((select s.promotional_enabled from public.sales_whatsapp_settings s where s.id), false) then
    raise exception 'Promotional WhatsApp messages are switched off.';
  end if;
  v_problem := public._sales_wa_content_problem(m.kind, m.body);
  if v_problem is not null then raise exception '%', v_problem; end if;
  v_problem := public._sales_wa_problem(m.consent_id, m.kind, m.id);
  if v_problem is not null then raise exception '%', v_problem; end if;

  update public.sales_whatsapp_messages
     set status = 'approved', approved_hash = payload_hash, reviewed_by = p_reviewed_by, reviewed_at = now(),
         review_note = v_note, updated_at = now()
   where id = p_id;
  return 'approved';
end;
$$;

create or replace function public.admin_withdraw_sales_whatsapp(p_id uuid)
returns void
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  m public.sales_whatsapp_messages%rowtype;
begin
  if not auth_is_super_admin() then
    raise exception 'Not authorized to manage WhatsApp messages.';
  end if;
  select * into m from public.sales_whatsapp_messages where id = p_id for update;
  if not found then raise exception 'Message not found.'; end if;
  if m.status = 'cancelled' then return; end if;
  if m.status not in ('proposed', 'approved') then
    raise exception 'A message that is already % cannot be withdrawn.', m.status;
  end if;
  update public.sales_whatsapp_messages set status = 'cancelled', updated_at = now() where id = p_id;
end;
$$;

-- A person says they sent an approved message from their own WhatsApp. Returns {ok, message}.
-- A refusal is returned (not raised) so that an expiry it records is kept. This does NOT send anything.
create or replace function public.admin_mark_sales_whatsapp_sent(p_id uuid, p_sent_by uuid)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  m public.sales_whatsapp_messages%rowtype;
  v_problem text;
begin
  if not auth_is_super_admin() then
    raise exception 'Not authorized to manage WhatsApp messages.';
  end if;
  if p_sent_by is null or not exists (select 1 from public.platform_team_members where id = p_sent_by) then
    raise exception 'Say who sent this message.';
  end if;
  select * into m from public.sales_whatsapp_messages where id = p_id for update;
  if not found then raise exception 'Message not found.'; end if;

  if m.status = 'sent' then return jsonb_build_object('ok', true, 'already_sent', true); end if;
  if m.status <> 'approved' then
    return jsonb_build_object('ok', false, 'message', 'Only an approved message can be marked as sent (this one is ' || m.status || ').');
  end if;
  if m.reviewed_at < now() - interval '24 hours' then
    update public.sales_whatsapp_messages set status = 'expired', updated_at = now() where id = p_id;
    return jsonb_build_object('ok', false, 'message', 'The approval expired after 24 hours. Propose the message again.');
  end if;
  if public._sales_wa_hash(m.consent_id, m.phone, m.kind, m.body) is distinct from m.approved_hash then
    return jsonb_build_object('ok', false, 'message', 'The message no longer matches what was approved.');
  end if;
  if m.kind = 'promotional' and not coalesce((select s.promotional_enabled from public.sales_whatsapp_settings s where s.id), false) then
    return jsonb_build_object('ok', false, 'message', 'Promotional WhatsApp messages are switched off.');
  end if;
  v_problem := public._sales_wa_problem(m.consent_id, m.kind, m.id);
  if v_problem is not null then return jsonb_build_object('ok', false, 'message', v_problem); end if;
  if (select count(*) from public.sales_whatsapp_messages x where x.status = 'sent' and x.sent_at > now() - interval '24 hours') >= 40 then
    return jsonb_build_object('ok', false, 'message', 'Daily limit reached: at most 40 WhatsApp messages in 24 hours.');
  end if;

  update public.sales_whatsapp_messages
     set status = 'sent', sent_at = now(), sent_by = p_sent_by, send_method = 'manual', updated_at = now()
   where id = p_id;
  return jsonb_build_object('ok', true);
end;
$$;

revoke all on function public.admin_record_whatsapp_consent(text, text, text, text, text, text, uuid, uuid) from public, anon;
revoke all on function public.admin_withdraw_whatsapp_consent(uuid, uuid, text) from public, anon;
revoke all on function public.admin_get_sales_whatsapp_settings() from public, anon;
revoke all on function public.admin_set_sales_whatsapp_settings(boolean, uuid) from public, anon;
revoke all on function public.admin_propose_sales_whatsapp(uuid, text, text, uuid) from public, anon;
revoke all on function public.admin_edit_sales_whatsapp(uuid, text) from public, anon;
revoke all on function public.admin_review_sales_whatsapp(uuid, text, text, uuid, text) from public, anon;
revoke all on function public.admin_withdraw_sales_whatsapp(uuid) from public, anon;
revoke all on function public.admin_mark_sales_whatsapp_sent(uuid, uuid) from public, anon;
grant execute on function public.admin_record_whatsapp_consent(text, text, text, text, text, text, uuid, uuid) to authenticated;
grant execute on function public.admin_withdraw_whatsapp_consent(uuid, uuid, text) to authenticated;
grant execute on function public.admin_get_sales_whatsapp_settings() to authenticated;
grant execute on function public.admin_set_sales_whatsapp_settings(boolean, uuid) to authenticated;
grant execute on function public.admin_propose_sales_whatsapp(uuid, text, text, uuid) to authenticated;
grant execute on function public.admin_edit_sales_whatsapp(uuid, text) to authenticated;
grant execute on function public.admin_review_sales_whatsapp(uuid, text, text, uuid, text) to authenticated;
grant execute on function public.admin_withdraw_sales_whatsapp(uuid) to authenticated;
grant execute on function public.admin_mark_sales_whatsapp_sent(uuid, uuid) to authenticated;
