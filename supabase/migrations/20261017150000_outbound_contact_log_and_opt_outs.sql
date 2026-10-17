-- Outbound contact log + prospect opt-outs + wider dedupe (Growth Engine, PR 2 of 5).
--
-- Must apply AFTER 20261017120000_outbound_contact_enrichment.sql: it reads outbound_prospects.contact_status
-- and replaces admin_promote_outbound_prospect on top of that migration's version (keeping its
-- "confirm found contact details first" gate).
--
-- Additive: two new tables, five new functions, and CREATE OR REPLACE (UNCHANGED signatures, so no
-- overload is created) of admin_import_outbound_prospects and admin_promote_outbound_prospect.
-- One CHECK constraint on sales_leads.source is WIDENED (adds 'outbound'); no existing row can
-- violate a wider list. Nothing is dropped, renamed or backfilled; no existing data is rewritten.
--
-- Why new tables (and not the existing ones):
--  * Email opt-outs already have ONE source of truth: marketing_email_suppressions (checked at
--    campaign creation and send time). It is reused as-is for the 'email' channel; nothing is
--    duplicated. It has no equivalent for phone channels, which is what prospect_channel_opt_outs adds.
--  * sales_lead_activities is the log for leads a human is already pursuing, and it requires a lead.
--    Prospects are unvetted and deliberately NOT in the pipeline, so "which draft did we copy / send,
--    to whom, when" needs its own small log. Rows are manual, self-reported by the rep; nothing here
--    sends anything or proves delivery.
--
-- Rules enforced by the database (not by the UI):
--  * Only an APPROVED (or already promoted) prospect can be logged as contacted. No approval, no contact.
--  * A suppressed email / opted-out phone can never be logged as contacted, and is skipped on import,
--    so a re-imported list cannot resurface someone who said stop.
--  * Opt-outs are one-way here: there is intentionally no function that removes one. Reversing an
--    opt-out must be a deliberate, manual service-role action on the person's own request.
--
-- Access model matches outbound_prospects / sales_leads: super admin can read; nobody gets
-- insert/update/delete on the tables directly; every write is a SECURITY DEFINER function that
-- checks auth_is_super_admin() itself and raises a real exception on a bad id.

-- ============================================================
-- 0. Widen sales_leads.source with 'outbound' (so reporting can tell prospecting leads apart).
--    Looks the constraint up by definition rather than by name, so it works whatever it was called.
-- ============================================================
do $$
declare
  c record;
begin
  if exists (
    select 1 from pg_constraint
     where conrelid = 'public.sales_leads'::regclass
       and contype = 'c'
       and pg_get_constraintdef(oid) like '%door_visit%'
       and pg_get_constraintdef(oid) like '%outbound%'
  ) then
    return; -- already widened
  end if;

  for c in
    select conname from pg_constraint
     where conrelid = 'public.sales_leads'::regclass
       and contype = 'c'
       and pg_get_constraintdef(oid) like '%door_visit%'
  loop
    execute format('alter table public.sales_leads drop constraint %I', c.conname);
  end loop;

  alter table public.sales_leads
    add constraint sales_leads_source_check check (
      source is null or source in
        ('door_visit', 'referral', 'association', 'inbound_web', 'whatsapp', 'outbound', 'other')
    );
end $$;

-- ============================================================
-- 1. Identifier normalisation (internal, never callable by clients).
--    email -> lower(btrim), must look like an address.
--    phone -> digits only, Kenyan numbers to 254XXXXXXXXX; other numbers kept as 9-15 digits.
-- ============================================================
create or replace function public._normalize_contact_identifier(p_channel text, p_identifier text)
returns text
language plpgsql
immutable
set search_path to 'public'
as $$
declare
  v text;
  d text;
begin
  if p_identifier is null then
    return null;
  end if;

  if p_channel = 'email' then
    v := lower(btrim(p_identifier));
    if char_length(v) <= 254 and v ~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$' then
      return v;
    end if;
    return null;
  end if;

  d := regexp_replace(p_identifier, '[^0-9]', '', 'g');
  if d ~ '^254[17][0-9]{8}$' then
    return d;
  elsif d ~ '^0[17][0-9]{8}$' then
    return '254' || substr(d, 2);
  elsif d ~ '^[17][0-9]{8}$' then
    return '254' || d;
  elsif d ~ '^[0-9]{9,15}$' then
    return d;
  end if;
  return null;
end;
$$;

revoke all on function public._normalize_contact_identifier(text, text) from public, anon, authenticated;

-- ============================================================
-- 2. Opt-out register for phone channels (email stays in marketing_email_suppressions).
-- ============================================================
create table if not exists public.prospect_channel_opt_outs (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  channel text not null check (channel in ('whatsapp', 'sms', 'phone')),
  -- Normalised by _normalize_contact_identifier: digits only, Kenyan numbers as 254XXXXXXXXX.
  identifier text not null check (identifier ~ '^[0-9]{9,15}$'),
  reason text not null default 'requested' check (reason in ('requested', 'stop_reply', 'complained', 'manual')),
  note text check (note is null or char_length(note) <= 500),
  recorded_by uuid references auth.users(id) on delete set null,
  constraint prospect_channel_opt_outs_channel_identifier_key unique (channel, identifier)
);

comment on table public.prospect_channel_opt_outs is
  'Numbers that must not be contacted by outbound prospecting on a given channel (STOP replies, "do not call me"). Super-admin read only; writes via admin_record_outbound_opt_out(). Email opt-outs live in marketing_email_suppressions. Entries are never removed by the app.';

-- ============================================================
-- 3. Contact log (manual, self-reported by the rep).
-- ============================================================
create table if not exists public.outbound_contact_log (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  prospect_id uuid not null references public.outbound_prospects(id) on delete cascade,
  channel text not null check (channel in ('email', 'whatsapp', 'sms', 'phone')),
  -- draft_copied: rep copied the draft to send it themselves. sent: rep says they sent/made it.
  -- replied: the prospect answered. opted_out: written only by admin_record_outbound_opt_out().
  event text not null check (event in ('draft_copied', 'sent', 'replied', 'opted_out')),
  performed_by uuid references public.platform_team_members(id) on delete set null,
  note text check (note is null or char_length(note) <= 500)
);

comment on table public.outbound_contact_log is
  'Who copied/sent/heard back on an outbound prospect draft, per channel. Manual and self-reported: it records what a rep says they did, not proof of delivery. Super-admin read only; writes via admin_log_outbound_contact() / admin_record_outbound_opt_out(). Deleted with the prospect.';

create index if not exists outbound_contact_log_prospect_idx
  on public.outbound_contact_log (prospect_id, created_at desc);
create index if not exists outbound_contact_log_performed_by_idx
  on public.outbound_contact_log (performed_by) where performed_by is not null;

alter table public.prospect_channel_opt_outs enable row level security;
alter table public.outbound_contact_log enable row level security;

revoke all on public.prospect_channel_opt_outs from anon, authenticated;
revoke all on public.outbound_contact_log from anon, authenticated;
grant select on public.prospect_channel_opt_outs to authenticated;
grant select on public.outbound_contact_log to authenticated;

drop policy if exists "prospect_channel_opt_outs_select" on public.prospect_channel_opt_outs;
create policy "prospect_channel_opt_outs_select"
  on public.prospect_channel_opt_outs
  for select
  to authenticated
  using (auth_is_super_admin());

drop policy if exists "outbound_contact_log_select" on public.outbound_contact_log;
create policy "outbound_contact_log_select"
  on public.outbound_contact_log
  for select
  to authenticated
  using (auth_is_super_admin());

-- ============================================================
-- 4. Is this address / number opted out on this channel?
--    A value that cannot be normalised returns false (there is nothing to match); callers must
--    separately refuse to contact a prospect that has no usable address or number.
-- ============================================================
create or replace function public.admin_is_outbound_contact_blocked(p_channel text, p_identifier text)
returns boolean
language plpgsql
stable
security definer
set search_path to 'public'
as $$
declare
  v text;
begin
  if not auth_is_super_admin() then
    raise exception 'Not authorized to manage outbound prospects.';
  end if;
  if p_channel not in ('email', 'whatsapp', 'sms', 'phone') then
    raise exception 'Unknown channel.';
  end if;

  v := public._normalize_contact_identifier(p_channel, p_identifier);
  if v is null then
    return false;
  end if;

  if p_channel = 'email' then
    return exists (select 1 from public.marketing_email_suppressions m where m.email = v);
  end if;
  return exists (
    select 1 from public.prospect_channel_opt_outs o where o.channel = p_channel and o.identifier = v
  );
end;
$$;

revoke all on function public.admin_is_outbound_contact_blocked(text, text) from public, anon;
grant execute on function public.admin_is_outbound_contact_blocked(text, text) to authenticated;

-- ============================================================
-- 5. Log a contact on a prospect. Returns the log row id.
--    draft_copied / sent need: an approved-or-promoted prospect, confirmed contact details (not still
--    'scraped' / 'ai_found'), a usable address/number for the channel, and no opt-out. replied is always allowed (hearing back is a fact, not an action).
-- ============================================================
create or replace function public.admin_log_outbound_contact(
  p_prospect_id uuid,
  p_channel text,
  p_event text,
  p_performed_by uuid default null,
  p_note text default null
)
returns uuid
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  p public.outbound_prospects%rowtype;
  v_ident text;
  v_id uuid;
begin
  if not auth_is_super_admin() then
    raise exception 'Not authorized to manage outbound prospects.';
  end if;
  if p_channel not in ('email', 'whatsapp', 'sms', 'phone') then
    raise exception 'Unknown channel.';
  end if;
  if p_event = 'opted_out' then
    raise exception 'Record an opt-out with admin_record_outbound_opt_out().';
  end if;
  if p_event not in ('draft_copied', 'sent', 'replied') then
    raise exception 'Event must be draft_copied, sent or replied.';
  end if;

  select * into p from public.outbound_prospects where id = p_prospect_id;
  if not found then
    raise exception 'Outbound prospect not found.';
  end if;

  if p_event in ('draft_copied', 'sent') then
    if p.status not in ('approved', 'promoted') then
      raise exception 'Only an approved prospect can be contacted.';
    end if;

    -- Same principle as promotion: details found by a scraper or AI search are unverified until a
    -- person confirms them (admin_confirm_outbound_prospect_contacts), so they cannot be contacted yet.
    if p.contact_status in ('scraped', 'ai_found') then
      raise exception 'Confirm the found contact details before contacting this school.';
    end if;

    v_ident := public._normalize_contact_identifier(
      p_channel,
      case when p_channel = 'email' then p.email else p.phone end
    );
    if v_ident is null then
      raise exception 'This prospect has no usable contact for that channel.';
    end if;

    if (p_channel = 'email' and exists (select 1 from public.marketing_email_suppressions m where m.email = v_ident))
       or (p_channel <> 'email' and exists (
         select 1 from public.prospect_channel_opt_outs o where o.channel = p_channel and o.identifier = v_ident
       )) then
      raise exception 'This contact has opted out and must not be contacted.';
    end if;
  end if;

  insert into public.outbound_contact_log (prospect_id, channel, event, performed_by, note)
  values (p_prospect_id, p_channel, p_event, p_performed_by, nullif(btrim(p_note), ''))
  returning id into v_id;

  return v_id;
end;
$$;

revoke all on function public.admin_log_outbound_contact(uuid, text, text, uuid, text) from public, anon;
grant execute on function public.admin_log_outbound_contact(uuid, text, text, uuid, text) to authenticated;

-- ============================================================
-- 6. Record an opt-out (e.g. a STOP reply). Idempotent. Returns how many prospects it matched.
--    email   -> marketing_email_suppressions (the existing single source of truth)
--    others  -> prospect_channel_opt_outs
-- ============================================================
create or replace function public.admin_record_outbound_opt_out(
  p_channel text,
  p_identifier text,
  p_reason text default 'requested',
  p_note text default null
)
returns integer
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v text;
  v_matched integer;
begin
  if not auth_is_super_admin() then
    raise exception 'Not authorized to manage outbound prospects.';
  end if;
  if p_channel not in ('email', 'whatsapp', 'sms', 'phone') then
    raise exception 'Unknown channel.';
  end if;
  if p_reason not in ('requested', 'stop_reply', 'complained', 'manual') then
    raise exception 'Reason must be requested, stop_reply, complained or manual.';
  end if;

  v := public._normalize_contact_identifier(p_channel, p_identifier);
  if v is null then
    raise exception 'That is not a valid % to opt out.', case when p_channel = 'email' then 'email address' else 'phone number' end;
  end if;

  if p_channel = 'email' then
    insert into public.marketing_email_suppressions (email, reason)
    values (v, case p_reason when 'complained' then 'complained' when 'manual' then 'manual' else 'unsubscribed' end)
    on conflict (email) do nothing;
  else
    insert into public.prospect_channel_opt_outs (channel, identifier, reason, note, recorded_by)
    values (p_channel, v, p_reason, nullif(btrim(p_note), ''), auth.uid())
    on conflict (channel, identifier) do nothing;
  end if;

  -- Note it on every matching prospect, once per channel.
  insert into public.outbound_contact_log (prospect_id, channel, event, note)
  select p.id, p_channel, 'opted_out', nullif(btrim(p_note), '')
    from public.outbound_prospects p
   where public._normalize_contact_identifier(p_channel, case when p_channel = 'email' then p.email else p.phone end) = v
     and not exists (
       select 1 from public.outbound_contact_log l
        where l.prospect_id = p.id and l.channel = p_channel and l.event = 'opted_out'
     );
  get diagnostics v_matched = row_count;

  return v_matched;
end;
$$;

revoke all on function public.admin_record_outbound_opt_out(text, text, text, text) from public, anon;
grant execute on function public.admin_record_outbound_opt_out(text, text, text, text) to authenticated;

-- ============================================================
-- 7. Import: same behaviour as before (duplicates skipped, never overwritten), now ALSO skipping
--    schools that are already customers, already requested a demo, share an email/phone with an
--    existing sales lead, or have opted out. Signature unchanged. The result gains one key
--    (skipped_opted_out); inserted/skipped keep their meaning.
-- ============================================================
create or replace function public.admin_import_outbound_prospects(p_rows jsonb, p_source_note text)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_row jsonb;
  v_name text;
  v_county text;
  v_key text;
  v_email text;
  v_phone text;
  v_inserted integer := 0;
  v_skipped integer := 0;
  v_opted_out integer := 0;
  v_count integer;
begin
  if not auth_is_super_admin() then
    raise exception 'Not authorized to manage outbound prospects.';
  end if;
  if p_rows is null or jsonb_typeof(p_rows) <> 'array' then
    raise exception 'Rows must be a JSON array.';
  end if;
  v_count := jsonb_array_length(p_rows);
  if v_count = 0 then
    raise exception 'No rows to import.';
  end if;
  if v_count > 500 then
    raise exception 'Import at most 500 schools at a time.';
  end if;

  for v_row in select * from jsonb_array_elements(p_rows) loop
    v_name := nullif(btrim(v_row ->> 'school_name'), '');
    v_county := nullif(btrim(v_row ->> 'town_county'), '');
    if v_name is null then
      v_skipped := v_skipped + 1;
      continue;
    end if;
    v_key := lower(v_name) || '|' || lower(coalesce(v_county, ''));
    v_email := public._normalize_contact_identifier('email', v_row ->> 'email');
    v_phone := public._normalize_contact_identifier('phone', v_row ->> 'phone');

    -- Someone who said stop must not come back through a re-import.
    if (v_email is not null and exists (select 1 from public.marketing_email_suppressions m where m.email = v_email))
       or (v_phone is not null and exists (select 1 from public.prospect_channel_opt_outs o where o.identifier = v_phone)) then
      v_skipped := v_skipped + 1;
      v_opted_out := v_opted_out + 1;
      continue;
    end if;

    -- Already being pursued in the sales pipeline (by name, email or phone).
    if exists (
      select 1 from public.sales_leads l
       where lower(btrim(l.school_name)) = lower(v_name)
          or (v_email is not null and public._normalize_contact_identifier('email', l.email) = v_email)
          or (v_phone is not null and public._normalize_contact_identifier('phone', l.phone) = v_phone)
    ) then
      v_skipped := v_skipped + 1;
      continue;
    end if;

    -- Already a school on the platform.
    if exists (select 1 from public.schools s where lower(btrim(s.name)) = lower(v_name)) then
      v_skipped := v_skipped + 1;
      continue;
    end if;

    -- Already asked for a demo through the website.
    if exists (
      select 1 from public.marketing_demo_requests d
       where lower(btrim(d.school_name)) = lower(v_name)
          or (v_email is not null and lower(btrim(d.email)) = v_email)
    ) then
      v_skipped := v_skipped + 1;
      continue;
    end if;

    insert into public.outbound_prospects (
      school_name, town_county, dedupe_key, school_type, school_level, website, phone, email,
      contact_name, contact_role, student_count, source_note
    ) values (
      v_name, v_county, v_key,
      nullif(v_row ->> 'school_type', ''),
      nullif(v_row ->> 'school_level', ''),
      nullif(btrim(v_row ->> 'website'), ''),
      nullif(btrim(v_row ->> 'phone'), ''),
      nullif(lower(btrim(v_row ->> 'email')), ''),
      nullif(btrim(v_row ->> 'contact_name'), ''),
      nullif(btrim(v_row ->> 'contact_role'), ''),
      nullif(v_row ->> 'student_count', '')::integer,
      nullif(btrim(p_source_note), '')
    )
    on conflict (dedupe_key) do nothing;

    if found then
      v_inserted := v_inserted + 1;
    else
      v_skipped := v_skipped + 1;
    end if;
  end loop;

  return jsonb_build_object('inserted', v_inserted, 'skipped', v_skipped, 'skipped_opted_out', v_opted_out);
end;
$$;

-- ============================================================
-- 8. Promote: identical to the current version (incl. the confirmed-contact gate) except the new lead's
--    source is 'outbound' (was 'other').
--    Existing promoted leads are left as they are.
-- ============================================================
-- (Body is 20261017120000_outbound_contact_enrichment.sql's version, including its confirmation gate;
-- the only change is source 'other' -> 'outbound'.)
create or replace function public.admin_promote_outbound_prospect(p_id uuid, p_assigned_to uuid default null)
returns uuid
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  p public.outbound_prospects%rowtype;
  v_lead_id uuid;
  v_notes text;
begin
  if not auth_is_super_admin() then
    raise exception 'Not authorized to manage outbound prospects.';
  end if;

  select * into p from public.outbound_prospects where id = p_id for update;
  if not found then
    raise exception 'Outbound prospect not found.';
  end if;
  if p.status = 'promoted' then
    raise exception 'This prospect has already been added to the sales pipeline.';
  end if;
  if p.status <> 'approved' then
    raise exception 'Only an approved prospect can be added to the sales pipeline.';
  end if;
  if p.contact_status in ('scraped', 'ai_found') then
    raise exception 'Confirm the found contact details before adding this school to the pipeline.';
  end if;

  v_notes := left(
    'Outbound prospect (fit ' || coalesce(p.fit_score::text, '?') || '/100). '
      || coalesce(p.fit_reason, '')
      || case when p.school_level is not null then E'\nLevel: ' || p.school_level else '' end
      || case when p.source_note is not null then E'\nSource: ' || p.source_note else '' end
      || case when p.contact_source_url is not null then E'\nContact source: ' || p.contact_source_url else '' end
      || case when p.website is not null then E'\nWebsite: ' || p.website else '' end,
    4000
  );

  insert into public.sales_leads (
    school_name, town_county, school_type, contact_name, contact_role, phone, email,
    source, student_count, assigned_to, notes
  ) values (
    p.school_name, p.town_county, p.school_type, p.contact_name, p.contact_role, p.phone, p.email,
    'outbound', p.student_count, p_assigned_to, v_notes
  )
  returning id into v_lead_id;

  update public.outbound_prospects
     set status = 'promoted', promoted_lead_id = v_lead_id, updated_at = now()
   where id = p_id;

  return v_lead_id;
end;
$$;

-- CREATE OR REPLACE keeps existing grants, but state them so the file is self-describing.
revoke all on function public.admin_import_outbound_prospects(jsonb, text) from public, anon;
grant execute on function public.admin_import_outbound_prospects(jsonb, text) to authenticated;
revoke all on function public.admin_promote_outbound_prospect(uuid, uuid) from public, anon;
grant execute on function public.admin_promote_outbound_prospect(uuid, uuid) to authenticated;
