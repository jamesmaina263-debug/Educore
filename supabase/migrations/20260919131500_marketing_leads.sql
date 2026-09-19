-- Marketing site: lightweight lead-magnet capture (exit-intent / scroll-depth
-- prompt offering the CBC Digital Readiness Checklist download in exchange
-- for an email address). Same isolation posture as marketing_demo_requests
-- (20260828203537_marketing_demo_requests.sql): a table with no foreign keys
-- into the tenant schema, not read anywhere in the authenticated product,
-- insert-only for the public site plus a super-admin-only select policy --
-- following that table's later evolution (20260829065615_marketing_demo_
-- requests_admin_select.sql) directly rather than repeating its two-step
-- history, since there's no existing admin surface here yet to avoid
-- breaking.
--
-- `resource` identifies which lead magnet was downloaded, defaulting to the
-- only one that exists today -- present from the start so a second magnet
-- later doesn't require a schema change, just a new default value from the
-- client.
--
-- Unique on email (lowercased before insert by the server action, so this
-- achieves case-insensitive de-duplication without needing an expression
-- index -- Postgres/PostgREST's upsert onConflict target must reference an
-- actual constraint or plain-column index, not an arbitrary expression).
-- The client-side 30-day localStorage suppression (see
-- ExitIntentLeadMagnet) is the primary defense against duplicate rows from
-- the same visitor, but it's not authoritative (cleared storage, different
-- browser, private/incognito). onConflict + ignoreDuplicates at the call
-- site makes a resubmission idempotent rather than surfacing a
-- constraint-violation error to a real visitor.
create table if not exists public.marketing_leads (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  email text not null unique,
  resource text not null default 'cbc_digital_readiness_checklist',
  source_page text,
  utm_source text,
  utm_medium text,
  utm_campaign text
);

comment on table public.marketing_leads is
  'Public marketing-site lead-magnet email captures (exit-intent / scroll-depth prompt). Isolated from the tenant schema, insert-only for anon/authenticated, readable by super admins.';

alter table public.marketing_leads enable row level security;

-- Insert-only, for both anonymous visitors and any authenticated session a
-- visitor happens to be carrying (the marketing layout has no session
-- check, so either could trigger this prompt) -- same reasoning as
-- marketing_demo_requests_insert.
create policy "marketing_leads_insert"
  on public.marketing_leads
  for insert
  to anon, authenticated
  with check (true);

-- Same authorization convention as marketing_demo_requests_select
-- (20260829065615): super admin only, no school_id scoping since this
-- table isn't tenant-scoped.
create policy "marketing_leads_select"
  on public.marketing_leads
  for select
  to authenticated
  using (auth_is_super_admin());
