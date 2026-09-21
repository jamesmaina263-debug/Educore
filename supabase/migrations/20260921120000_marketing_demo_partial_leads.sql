-- Two-step demo request form: step 1 (name, school, email, optional phone) is saved the moment
-- the visitor presses Continue, so someone who starts the form and never finishes step 2 is
-- still a contact platform staff can follow up.
--
-- Why a separate table instead of rows in marketing_demo_requests: that table is treated as
-- "a real demo request" everywhere -- the admin list, the analytics funnel's "Demo Request
-- Submitted" fallback count, and the notify_admin_new_demo_request trigger (in-app + email
-- alert). A half-finished lead in there would inflate all three.
--
-- Write path: server action only (service role, after honeypot / fill-time / per-IP rate-limit
-- checks). There is deliberately NO anon/authenticated insert policy and no table grants for
-- either role, so this endpoint can never be hit straight from the browser with the anon key.
-- Read path: super admin only, same convention as marketing_demo_requests_select.
--
-- Retention: rows are purged after p_days (default 60) by purge_stale_demo_partial_leads(),
-- called from the daily communication-retention cron. Completed rows are kept only as a
-- marker until purged; the full details live on the real marketing_demo_requests row.

create table if not exists public.marketing_demo_partial_leads (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  -- 'incomplete' = saved at step 1, never submitted; 'contacted' = staff followed up;
  -- 'completed' = the visitor did submit the full form afterwards (matched by email).
  status text not null default 'incomplete'
    check (status in ('incomplete', 'contacted', 'completed')),
  name text not null,
  school_name text not null,
  -- Stored lowercased/trimmed by the server action so it can be matched exactly when the same
  -- visitor completes the form.
  email text not null,
  phone text,
  source_page text,
  utm_source text,
  utm_medium text,
  utm_campaign text,
  utm_term text,
  utm_content text,
  gclid text,
  gbraid text,
  wbraid text,
  completed_at timestamptz,
  constraint marketing_demo_partial_leads_email_lower_check check (email = lower(email))
);

comment on table public.marketing_demo_partial_leads is
  'Step-1 contact details from the two-step /contact demo form, saved before the visitor finishes the form. Written only by the server action (service role); readable by super admins; purged after 60 days.';

-- At most one open (incomplete) row per email: a visitor who retries step 1 updates the same row.
create unique index if not exists marketing_demo_partial_leads_open_email_idx
  on public.marketing_demo_partial_leads (email)
  where status = 'incomplete';

create index if not exists marketing_demo_partial_leads_created_at_idx
  on public.marketing_demo_partial_leads (created_at desc);

alter table public.marketing_demo_partial_leads enable row level security;

revoke all on public.marketing_demo_partial_leads from anon, authenticated;
grant select on public.marketing_demo_partial_leads to authenticated;

create policy "marketing_demo_partial_leads_select"
  on public.marketing_demo_partial_leads
  for select
  to authenticated
  using (auth_is_super_admin());

-- Staff can mark a lead contacted (or back to incomplete). Narrow RPC, status only, same
-- convention as admin_update_demo_request_status.
create or replace function public.admin_set_demo_partial_lead_status(p_id uuid, p_status text)
returns void
language plpgsql
security definer
set search_path to 'public'
as $$
begin
  if not (auth_is_super_admin() or auth.role() = 'service_role') then
    raise exception 'Not authorized to update incomplete demo leads.';
  end if;

  if p_status not in ('incomplete', 'contacted') then
    raise exception 'Invalid status: %', p_status;
  end if;

  update public.marketing_demo_partial_leads
  set status = p_status, updated_at = now()
  where id = p_id and status <> 'completed';

  if not found then
    raise exception 'Incomplete demo lead not found: %', p_id;
  end if;
end;
$$;

revoke all on function public.admin_set_demo_partial_lead_status(uuid, text) from public, anon;
grant execute on function public.admin_set_demo_partial_lead_status(uuid, text) to authenticated;

create or replace function public.admin_delete_demo_partial_lead(p_id uuid)
returns void
language plpgsql
security definer
set search_path to 'public'
as $$
begin
  if not (auth_is_super_admin() or auth.role() = 'service_role') then
    raise exception 'Not authorized to delete incomplete demo leads.';
  end if;

  delete from public.marketing_demo_partial_leads where id = p_id;

  if not found then
    raise exception 'Incomplete demo lead not found: %', p_id;
  end if;
end;
$$;

revoke all on function public.admin_delete_demo_partial_lead(uuid) from public, anon;
grant execute on function public.admin_delete_demo_partial_lead(uuid) to authenticated;

-- Retention sweep. Service role only (called by the cron route), never by a client.
create or replace function public.purge_stale_demo_partial_leads(p_days integer default 60)
returns integer
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_deleted integer;
begin
  if p_days < 1 then
    raise exception 'p_days must be at least 1';
  end if;

  delete from public.marketing_demo_partial_leads
  where created_at < now() - make_interval(days => p_days);

  get diagnostics v_deleted = row_count;
  return v_deleted;
end;
$$;

revoke all on function public.purge_stale_demo_partial_leads(integer) from public, anon, authenticated;
grant execute on function public.purge_stale_demo_partial_leads(integer) to service_role;
