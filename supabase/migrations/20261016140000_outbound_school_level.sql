-- Adds school_level (kindergarten / primary / secondary / other) to outbound_prospects so
-- kindergartens and nursery schools can be discovered, scored and pitched as their own segment.
-- Additive: one nullable column, and CREATE OR REPLACE of two functions with UNCHANGED signatures
-- (so no overload is created) to carry the new field through import and promotion.

alter table public.outbound_prospects
  add column if not exists school_level text
  check (school_level is null or school_level in ('kindergarten', 'primary', 'secondary', 'other'));

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

    if exists (select 1 from public.sales_leads l where lower(btrim(l.school_name)) = lower(v_name)) then
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

  return jsonb_build_object('inserted', v_inserted, 'skipped', v_skipped);
end;
$$;

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
      || case when p.school_level is not null then E'\nLevel: ' || p.school_level else '' end
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

-- CREATE OR REPLACE keeps existing grants, but state them so the file is self-describing.
revoke all on function public.admin_import_outbound_prospects(jsonb, text) from public, anon;
grant execute on function public.admin_import_outbound_prospects(jsonb, text) to authenticated;
revoke all on function public.admin_promote_outbound_prospect(uuid, uuid) from public, anon;
grant execute on function public.admin_promote_outbound_prospect(uuid, uuid) to authenticated;
