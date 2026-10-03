-- Optional first-name field on the checklist-download form, so automated and manual prospect
-- emails can greet checklist downloaders by name ({{name}}) instead of "there". Additive and
-- nullable: existing rows keep a null name, and the app falls back to inserting without it if it
-- is ever briefly deployed ahead of this migration.
--
-- Also re-creates _prospect_audience() (same signature) so checklist rows carry their name.
-- Safe to run twice.

alter table public.marketing_leads
  add column if not exists name text;

alter table public.marketing_leads
  drop constraint if exists marketing_leads_name_length_check;
alter table public.marketing_leads
  add constraint marketing_leads_name_length_check check (name is null or char_length(name) <= 100);

comment on column public.marketing_leads.name is
  'Optional name typed on the checklist-download form; used to personalise prospect emails. Null when the visitor left it blank.';

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
    select 'checklist_download', nullif(trim(l.name), ''), null, lower(trim(l.email)), l.created_at, 2
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
