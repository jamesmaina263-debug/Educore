-- Contact enrichment for outbound prospects (/admin/outreach "Find contacts").
--
-- Found contact details (scraped from the school's own site, or located by AI web search and then
-- checked against the page) are UNVERIFIED until a human confirms them. This migration adds the
-- bookkeeping for that and a gate so an unconfirmed contact can't be promoted into the pipeline.
--
-- Additive: three nullable columns, two new functions, and CREATE OR REPLACE of
-- admin_promote_outbound_prospect with its signature UNCHANGED (no overload created).
--
-- contact_status: null            = contact details were imported by a person (CSV) or are absent
--                 'scraped'       = taken from the school's own website
--                 'ai_found'      = located by AI web search, then verified to appear on contact_source_url
--                 'verified'      = a human confirmed them

alter table public.outbound_prospects
  add column if not exists contact_status text
    check (contact_status is null or contact_status in ('scraped', 'ai_found', 'verified')),
  add column if not exists contact_source_url text
    check (contact_source_url is null or char_length(contact_source_url) <= 500),
  add column if not exists contact_found_at timestamptz;

-- Fill ONLY blank contact fields (never overwrite something a person typed or already confirmed).
-- A source URL is mandatory: "how did you get my details" must always have an answer.
create or replace function public.admin_set_outbound_prospect_contacts(
  p_id uuid,
  p_website text,
  p_phone text,
  p_email text,
  p_contact_name text,
  p_contact_role text,
  p_source_url text,
  p_method text
)
returns boolean
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  p public.outbound_prospects%rowtype;
  v_website text := nullif(btrim(p_website), '');
  v_phone text := nullif(btrim(p_phone), '');
  v_email text := nullif(lower(btrim(p_email)), '');
  v_name text := nullif(btrim(p_contact_name), '');
  v_role text := nullif(btrim(p_contact_role), '');
  v_changed boolean;
begin
  if not auth_is_super_admin() then
    raise exception 'Not authorized to manage outbound prospects.';
  end if;
  if p_method not in ('scraped', 'ai_found') then
    raise exception 'Method must be scraped or ai_found.';
  end if;
  if nullif(btrim(p_source_url), '') is null then
    raise exception 'A source URL is required for found contact details.';
  end if;

  select * into p from public.outbound_prospects where id = p_id for update;
  if not found then
    raise exception 'Outbound prospect not found.';
  end if;
  if p.status = 'promoted' then
    raise exception 'This prospect has already been added to the sales pipeline.';
  end if;

  v_changed :=
    (p.website is null and v_website is not null)
    or (p.phone is null and v_phone is not null)
    or (p.email is null and v_email is not null)
    or (p.contact_name is null and v_name is not null)
    or (p.contact_role is null and v_role is not null);
  if not v_changed then
    return false;
  end if;

  update public.outbound_prospects
     set website = coalesce(website, v_website),
         phone = coalesce(phone, v_phone),
         email = coalesce(email, v_email),
         contact_name = coalesce(contact_name, v_name),
         contact_role = coalesce(contact_role, v_role),
         -- the lower-trust label wins when both methods contributed
         contact_status = case when p.contact_status = 'ai_found' or p_method = 'ai_found' then 'ai_found' else 'scraped' end,
         contact_source_url = left(btrim(p_source_url), 500),
         contact_found_at = now(),
         updated_at = now()
   where id = p_id;

  return true;
end;
$$;

revoke all on function public.admin_set_outbound_prospect_contacts(uuid, text, text, text, text, text, text, text) from public, anon;
grant execute on function public.admin_set_outbound_prospect_contacts(uuid, text, text, text, text, text, text, text) to authenticated;

-- A human confirms the found contact details (after opening the source link).
create or replace function public.admin_confirm_outbound_prospect_contacts(p_id uuid)
returns void
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_status text;
  v_contact_status text;
begin
  if not auth_is_super_admin() then
    raise exception 'Not authorized to manage outbound prospects.';
  end if;

  select status, contact_status into v_status, v_contact_status
    from public.outbound_prospects where id = p_id for update;
  if not found then
    raise exception 'Outbound prospect not found.';
  end if;
  if v_status = 'promoted' then
    raise exception 'This prospect has already been added to the sales pipeline.';
  end if;
  if v_contact_status is null or v_contact_status = 'verified' then
    raise exception 'There are no unconfirmed contact details on this prospect.';
  end if;

  update public.outbound_prospects
     set contact_status = 'verified', updated_at = now()
   where id = p_id;
end;
$$;

revoke all on function public.admin_confirm_outbound_prospect_contacts(uuid) from public, anon;
grant execute on function public.admin_confirm_outbound_prospect_contacts(uuid) to authenticated;

-- Promotion now refuses unconfirmed found contacts and carries the contact source into the lead notes.
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
    'other', p.student_count, p_assigned_to, v_notes
  )
  returning id into v_lead_id;

  update public.outbound_prospects
     set status = 'promoted', promoted_lead_id = v_lead_id, updated_at = now()
   where id = p_id;

  return v_lead_id;
end;
$$;

revoke all on function public.admin_promote_outbound_prospect(uuid, uuid) from public, anon;
grant execute on function public.admin_promote_outbound_prospect(uuid, uuid) to authenticated;
