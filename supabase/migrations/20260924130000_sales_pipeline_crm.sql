-- Sales pipeline CRM for the platform sales team (/admin/sales-pipeline).
--
-- Purely additive: two new tables and four new functions. Nothing that already exists is
-- altered -- no existing table, policy, function, trigger or grant is touched -- so applying
-- this cannot change behaviour for any school or for any existing admin page.
--
-- Why new tables instead of reusing marketing_demo_requests: that table is treated as "a real
-- inbound demo request" everywhere (admin list, analytics funnel, the notify_admin_new_demo_
-- request trigger that emails/alerts on every insert). Field-visit leads a rep types in by hand
-- would inflate all three, the same reason marketing_demo_partial_leads is separate.
--
-- Access model: same convention as the other platform-admin tables. Super admin can read;
-- nobody gets insert/update/delete on the tables directly. Every write goes through a
-- SECURITY DEFINER function that checks auth_is_super_admin() itself and raises a real
-- exception when the row is missing (so a bad id never "succeeds" silently).
--
-- "Which rep did this" is recorded explicitly (platform_team_members) rather than taken from
-- the logged-in user, because the console login can be shared between reps.

create table if not exists public.sales_leads (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  school_name text not null check (char_length(btrim(school_name)) between 1 and 200),
  town_county text check (town_county is null or char_length(town_county) <= 200),
  school_type text check (school_type is null or school_type in ('public', 'private', 'other')),
  contact_name text check (contact_name is null or char_length(contact_name) <= 200),
  contact_role text check (contact_role is null or char_length(contact_role) <= 100),
  phone text check (phone is null or char_length(phone) <= 40),
  email text check (email is null or char_length(email) <= 254),
  current_system text check (current_system is null or char_length(current_system) <= 200),
  pain_points text check (pain_points is null or char_length(pain_points) <= 2000),
  source text check (
    source is null or source in ('door_visit', 'referral', 'association', 'inbound_web', 'whatsapp', 'other')
  ),
  student_count integer check (student_count is null or student_count between 0 and 100000),
  stage text not null default 'new'
    check (stage in ('new', 'visited', 'decision_maker_met', 'demo_booked', 'demo_done', 'pilot', 'paid', 'lost')),
  stage_changed_at timestamptz not null default now(),
  lost_reason text check (lost_reason is null or char_length(lost_reason) <= 500),
  assigned_to uuid references public.platform_team_members(id) on delete set null,
  next_follow_up_on date,
  notes text check (notes is null or char_length(notes) <= 4000),
  -- A lost lead must say why; every other stage must not carry a stale reason.
  constraint sales_leads_lost_reason_matches_stage check (
    (stage = 'lost' and lost_reason is not null) or (stage <> 'lost' and lost_reason is null)
  )
);

comment on table public.sales_leads is
  'Sales team pipeline: one row per school being pursued (field visits, referrals, association leads). Super-admin read only; all writes via admin_*_sales_lead* functions. Separate from marketing_demo_requests on purpose.';

create index if not exists sales_leads_stage_idx on public.sales_leads (stage);
create index if not exists sales_leads_assigned_to_idx on public.sales_leads (assigned_to);
create index if not exists sales_leads_follow_up_idx
  on public.sales_leads (next_follow_up_on)
  where next_follow_up_on is not null and stage not in ('paid', 'lost');

create table if not exists public.sales_lead_activities (
  id uuid primary key default gen_random_uuid(),
  lead_id uuid not null references public.sales_leads(id) on delete cascade,
  created_at timestamptz not null default now(),
  activity_type text not null
    check (activity_type in ('visit', 'call', 'whatsapp', 'demo', 'pilot_checkin', 'note', 'stage_change')),
  performed_by uuid references public.platform_team_members(id) on delete set null,
  summary text not null check (char_length(btrim(summary)) between 1 and 2000)
);

comment on table public.sales_lead_activities is
  'Dated activity log per sales lead (visit, call, demo, note...). stage_change rows are written only by admin_set_sales_lead_stage(). Super-admin read only.';

create index if not exists sales_lead_activities_lead_idx
  on public.sales_lead_activities (lead_id, created_at desc);
create index if not exists sales_lead_activities_created_idx
  on public.sales_lead_activities (created_at desc);

alter table public.sales_leads enable row level security;
alter table public.sales_lead_activities enable row level security;

revoke all on public.sales_leads from anon, authenticated;
revoke all on public.sales_lead_activities from anon, authenticated;
grant select on public.sales_leads to authenticated;
grant select on public.sales_lead_activities to authenticated;

drop policy if exists "sales_leads_select" on public.sales_leads;
create policy "sales_leads_select"
  on public.sales_leads
  for select
  to authenticated
  using (auth_is_super_admin());

drop policy if exists "sales_lead_activities_select" on public.sales_lead_activities;
create policy "sales_lead_activities_select"
  on public.sales_lead_activities
  for select
  to authenticated
  using (auth_is_super_admin());

-- Create (p_id null) or update a lead's descriptive fields. Deliberately does NOT change the
-- stage -- that goes through admin_set_sales_lead_stage() so every stage move is logged.
create or replace function public.admin_save_sales_lead(
  p_id uuid,
  p_school_name text,
  p_town_county text,
  p_school_type text,
  p_contact_name text,
  p_contact_role text,
  p_phone text,
  p_email text,
  p_current_system text,
  p_pain_points text,
  p_source text,
  p_student_count integer,
  p_assigned_to uuid,
  p_next_follow_up_on date,
  p_notes text
)
returns uuid
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_id uuid;
begin
  if not auth_is_super_admin() then
    raise exception 'Not authorized to manage sales leads.';
  end if;

  if p_school_name is null or btrim(p_school_name) = '' then
    raise exception 'School name is required.';
  end if;

  if p_id is null then
    insert into public.sales_leads (
      school_name, town_county, school_type, contact_name, contact_role, phone, email,
      current_system, pain_points, source, student_count, assigned_to, next_follow_up_on, notes
    ) values (
      btrim(p_school_name), nullif(btrim(p_town_county), ''), nullif(btrim(p_school_type), ''),
      nullif(btrim(p_contact_name), ''), nullif(btrim(p_contact_role), ''), nullif(btrim(p_phone), ''),
      nullif(btrim(p_email), ''), nullif(btrim(p_current_system), ''), nullif(btrim(p_pain_points), ''),
      nullif(btrim(p_source), ''), p_student_count, p_assigned_to, p_next_follow_up_on,
      nullif(btrim(p_notes), '')
    )
    returning id into v_id;
    return v_id;
  end if;

  update public.sales_leads
  set school_name = btrim(p_school_name),
      town_county = nullif(btrim(p_town_county), ''),
      school_type = nullif(btrim(p_school_type), ''),
      contact_name = nullif(btrim(p_contact_name), ''),
      contact_role = nullif(btrim(p_contact_role), ''),
      phone = nullif(btrim(p_phone), ''),
      email = nullif(btrim(p_email), ''),
      current_system = nullif(btrim(p_current_system), ''),
      pain_points = nullif(btrim(p_pain_points), ''),
      source = nullif(btrim(p_source), ''),
      student_count = p_student_count,
      assigned_to = p_assigned_to,
      next_follow_up_on = p_next_follow_up_on,
      notes = nullif(btrim(p_notes), ''),
      updated_at = now()
  where id = p_id;

  if not found then
    raise exception 'Sales lead not found: %', p_id;
  end if;

  return p_id;
end;
$$;

revoke all on function public.admin_save_sales_lead(
  uuid, text, text, text, text, text, text, text, text, text, text, integer, uuid, date, text
) from public, anon;
grant execute on function public.admin_save_sales_lead(
  uuid, text, text, text, text, text, text, text, text, text, text, integer, uuid, date, text
) to authenticated;

-- Move a lead to a new stage and write the matching stage_change activity in the same
-- transaction. 'lost' requires a reason.
create or replace function public.admin_set_sales_lead_stage(
  p_id uuid,
  p_stage text,
  p_lost_reason text default null,
  p_performed_by uuid default null
)
returns void
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_old text;
  v_reason text := nullif(btrim(p_lost_reason), '');
begin
  if not auth_is_super_admin() then
    raise exception 'Not authorized to manage sales leads.';
  end if;

  if p_stage not in ('new', 'visited', 'decision_maker_met', 'demo_booked', 'demo_done', 'pilot', 'paid', 'lost') then
    raise exception 'Invalid stage: %', p_stage;
  end if;

  if p_stage = 'lost' and v_reason is null then
    raise exception 'A reason is required when marking a lead as lost.';
  end if;

  select stage into v_old from public.sales_leads where id = p_id for update;
  if not found then
    raise exception 'Sales lead not found: %', p_id;
  end if;

  if v_old = p_stage and (p_stage <> 'lost' or v_reason is null) then
    return;
  end if;

  update public.sales_leads
  set stage = p_stage,
      lost_reason = case when p_stage = 'lost' then v_reason else null end,
      stage_changed_at = case when v_old = p_stage then stage_changed_at else now() end,
      updated_at = now()
  where id = p_id;

  insert into public.sales_lead_activities (lead_id, activity_type, performed_by, summary)
  values (
    p_id,
    'stage_change',
    p_performed_by,
    'Stage: ' || v_old || ' -> ' || p_stage || case when p_stage = 'lost' then ' (' || v_reason || ')' else '' end
  );
end;
$$;

revoke all on function public.admin_set_sales_lead_stage(uuid, text, text, uuid) from public, anon;
grant execute on function public.admin_set_sales_lead_stage(uuid, text, text, uuid) to authenticated;

-- Log a visit/call/demo/note against a lead, optionally moving its next follow-up date.
create or replace function public.admin_add_sales_lead_activity(
  p_lead_id uuid,
  p_type text,
  p_summary text,
  p_performed_by uuid,
  p_next_follow_up_on date default null
)
returns uuid
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_id uuid;
begin
  if not auth_is_super_admin() then
    raise exception 'Not authorized to manage sales leads.';
  end if;

  -- stage_change is reserved for admin_set_sales_lead_stage().
  if p_type not in ('visit', 'call', 'whatsapp', 'demo', 'pilot_checkin', 'note') then
    raise exception 'Invalid activity type: %', p_type;
  end if;

  if p_summary is null or btrim(p_summary) = '' then
    raise exception 'A short summary is required.';
  end if;

  if not exists (select 1 from public.sales_leads where id = p_lead_id) then
    raise exception 'Sales lead not found: %', p_lead_id;
  end if;

  insert into public.sales_lead_activities (lead_id, activity_type, performed_by, summary)
  values (p_lead_id, p_type, p_performed_by, btrim(p_summary))
  returning id into v_id;

  update public.sales_leads
  set updated_at = now(),
      next_follow_up_on = coalesce(p_next_follow_up_on, next_follow_up_on)
  where id = p_lead_id;

  return v_id;
end;
$$;

revoke all on function public.admin_add_sales_lead_activity(uuid, text, text, uuid, date) from public, anon;
grant execute on function public.admin_add_sales_lead_activity(uuid, text, text, uuid, date) to authenticated;

create or replace function public.admin_delete_sales_lead(p_id uuid)
returns void
language plpgsql
security definer
set search_path to 'public'
as $$
begin
  if not auth_is_super_admin() then
    raise exception 'Not authorized to manage sales leads.';
  end if;

  delete from public.sales_leads where id = p_id;

  if not found then
    raise exception 'Sales lead not found: %', p_id;
  end if;
end;
$$;

revoke all on function public.admin_delete_sales_lead(uuid) from public, anon;
grant execute on function public.admin_delete_sales_lead(uuid) to authenticated;
