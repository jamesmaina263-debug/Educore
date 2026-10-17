-- Outbound prospecting staging area (/admin/outreach).
--
-- Purely additive: one new table and five new functions. Nothing that already exists is altered.
--
-- Why a staging table instead of writing straight into sales_leads: schools found by list import
-- or AI scoring are UNVETTED. They must not appear in the sales pipeline (or any count) until a
-- human has approved them. Flow: import -> scored (Gemini fit score + drafts) -> approved|rejected
-- -> promoted (creates the sales_leads row, stage 'new').
--
-- This table holds drafts only. Nothing in it is ever sent automatically; sending stays with the
-- existing, suppression-aware email path or a rep's own phone.
--
-- Access model matches sales_leads: super admin can read; nobody gets insert/update/delete on the
-- table directly; every write goes through a SECURITY DEFINER function that checks
-- auth_is_super_admin() itself and raises a real exception when the row is missing.

create table if not exists public.outbound_prospects (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  school_name text not null check (char_length(btrim(school_name)) between 1 and 200),
  town_county text check (town_county is null or char_length(town_county) <= 200),
  -- lower(btrim(school_name)) || '|' || lower(btrim(coalesce(town_county, ''))); set by the import function.
  dedupe_key text not null,
  school_type text check (school_type is null or school_type in ('public', 'private', 'other')),
  website text check (website is null or char_length(website) <= 300),
  phone text check (phone is null or char_length(phone) <= 40),
  email text check (email is null or char_length(email) <= 254),
  contact_name text check (contact_name is null or char_length(contact_name) <= 200),
  contact_role text check (contact_role is null or char_length(contact_role) <= 100),
  student_count integer check (student_count is null or student_count between 0 and 100000),
  -- Where this row came from (e.g. 'MoE directory export, Oct 2026'). Needed to answer "how did you get my number".
  source_note text check (source_note is null or char_length(source_note) <= 300),
  fit_score integer check (fit_score is null or fit_score between 0 and 100),
  fit_reason text check (fit_reason is null or char_length(fit_reason) <= 1000),
  draft_email_subject text check (draft_email_subject is null or char_length(draft_email_subject) <= 200),
  draft_email_body text check (draft_email_body is null or char_length(draft_email_body) <= 4000),
  draft_whatsapp text check (draft_whatsapp is null or char_length(draft_whatsapp) <= 1000),
  status text not null default 'new'
    check (status in ('new', 'scored', 'approved', 'rejected', 'promoted')),
  promoted_lead_id uuid references public.sales_leads(id) on delete set null,
  constraint outbound_prospects_dedupe_key_key unique (dedupe_key),
  constraint outbound_prospects_promoted_has_lead check (status <> 'promoted' or promoted_lead_id is not null)
);

comment on table public.outbound_prospects is
  'Unvetted outbound prospect schools awaiting human review. Super-admin read only; all writes via admin_*_outbound_prospect* functions. Drafts only, never auto-sent. Approved rows are promoted into sales_leads.';

create index if not exists outbound_prospects_status_idx on public.outbound_prospects (status, fit_score desc nulls last);
create index if not exists outbound_prospects_promoted_lead_idx on public.outbound_prospects (promoted_lead_id) where promoted_lead_id is not null;

alter table public.outbound_prospects enable row level security;

revoke all on public.outbound_prospects from anon, authenticated;
grant select on public.outbound_prospects to authenticated;

drop policy if exists "outbound_prospects_select" on public.outbound_prospects;
create policy "outbound_prospects_select"
  on public.outbound_prospects
  for select
  to authenticated
  using (auth_is_super_admin());

-- ============================================================
-- Import: up to 500 rows per call. Duplicates (same name+county, or a school already in sales_leads)
-- are skipped, never overwritten, so a re-import can't clobber a reviewed row.
-- p_rows: jsonb array of {school_name, town_county, school_type, website, phone, email,
--                         contact_name, contact_role, student_count}
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
  v_inserted integer := 0;
  v_skipped integer := 0;
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

    -- Already being pursued in the sales pipeline.
    if exists (select 1 from public.sales_leads l where lower(btrim(l.school_name)) = lower(v_name)) then
      v_skipped := v_skipped + 1;
      continue;
    end if;

    insert into public.outbound_prospects (
      school_name, town_county, dedupe_key, school_type, website, phone, email,
      contact_name, contact_role, student_count, source_note
    ) values (
      v_name, v_county, v_key,
      nullif(v_row ->> 'school_type', ''),
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

  return jsonb_build_object('inserted', v_inserted, 'skipped', v_skipped);
end;
$$;

revoke all on function public.admin_import_outbound_prospects(jsonb, text) from public, anon;
grant execute on function public.admin_import_outbound_prospects(jsonb, text) to authenticated;

-- ============================================================
-- Store the AI fit score and drafts. Only touches rows still awaiting review; a row a human has
-- already approved/rejected/promoted is never silently rewritten.
-- ============================================================
create or replace function public.admin_set_outbound_prospect_scoring(
  p_id uuid,
  p_fit_score integer,
  p_fit_reason text,
  p_email_subject text,
  p_email_body text,
  p_whatsapp text
)
returns void
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_status text;
begin
  if not auth_is_super_admin() then
    raise exception 'Not authorized to manage outbound prospects.';
  end if;

  select status into v_status from public.outbound_prospects where id = p_id for update;
  if not found then
    raise exception 'Outbound prospect not found.';
  end if;
  if v_status not in ('new', 'scored') then
    raise exception 'This prospect has already been reviewed and can no longer be re-scored.';
  end if;

  update public.outbound_prospects
     set fit_score = p_fit_score,
         fit_reason = p_fit_reason,
         draft_email_subject = p_email_subject,
         draft_email_body = p_email_body,
         draft_whatsapp = p_whatsapp,
         status = 'scored',
         updated_at = now()
   where id = p_id;
end;
$$;

revoke all on function public.admin_set_outbound_prospect_scoring(uuid, integer, text, text, text, text) from public, anon;
grant execute on function public.admin_set_outbound_prospect_scoring(uuid, integer, text, text, text, text) to authenticated;

-- ============================================================
-- Human decision. 'scored' is the "undo" (back to the review queue). A promoted row is final.
-- ============================================================
create or replace function public.admin_review_outbound_prospect(p_id uuid, p_decision text)
returns void
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_status text;
begin
  if not auth_is_super_admin() then
    raise exception 'Not authorized to manage outbound prospects.';
  end if;
  if p_decision not in ('approved', 'rejected', 'scored') then
    raise exception 'Decision must be approved, rejected or scored.';
  end if;

  select status into v_status from public.outbound_prospects where id = p_id for update;
  if not found then
    raise exception 'Outbound prospect not found.';
  end if;
  if v_status = 'promoted' then
    raise exception 'This prospect has already been added to the sales pipeline.';
  end if;
  if v_status = 'new' and p_decision <> 'rejected' then
    raise exception 'Score this prospect before approving it.';
  end if;

  update public.outbound_prospects
     set status = p_decision, updated_at = now()
   where id = p_id;
end;
$$;

revoke all on function public.admin_review_outbound_prospect(uuid, text) from public, anon;
grant execute on function public.admin_review_outbound_prospect(uuid, text) to authenticated;

-- ============================================================
-- Promote an APPROVED prospect into the sales pipeline as a 'new' lead. Returns the lead id.
-- ============================================================
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

  v_notes := left(
    'Outbound prospect (fit ' || coalesce(p.fit_score::text, '?') || '/100). '
      || coalesce(p.fit_reason, '')
      || case when p.source_note is not null then E'\nSource: ' || p.source_note else '' end
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

-- ============================================================
-- Hard delete (e.g. a school asks to be removed). Refuses promoted rows: those live on as a lead.
-- ============================================================
create or replace function public.admin_delete_outbound_prospect(p_id uuid)
returns void
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_status text;
begin
  if not auth_is_super_admin() then
    raise exception 'Not authorized to manage outbound prospects.';
  end if;
  select status into v_status from public.outbound_prospects where id = p_id;
  if not found then
    raise exception 'Outbound prospect not found.';
  end if;
  if v_status = 'promoted' then
    raise exception 'This prospect is already in the sales pipeline; remove it there instead.';
  end if;
  delete from public.outbound_prospects where id = p_id;
end;
$$;

revoke all on function public.admin_delete_outbound_prospect(uuid) from public, anon;
grant execute on function public.admin_delete_outbound_prospect(uuid) to authenticated;
