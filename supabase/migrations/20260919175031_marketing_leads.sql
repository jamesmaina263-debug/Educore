-- Auto-reconciled by scripts/reconcile_migration_drift.py: this version was applied directly to production without a matching git commit at the time. Content below is byte-for-byte what's recorded in supabase_migrations.schema_migrations for version 20260919175031 -- reconstructed, not rewritten.

create table if not exists public.marketing_leads (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  email text not null,
  resource text not null default 'cbc_digital_readiness_checklist',
  source_page text,
  utm_source text,
  utm_medium text,
  utm_campaign text
);

comment on table public.marketing_leads is
  'Public marketing-site lead-magnet email captures (exit-intent / scroll-depth prompt). Isolated from the tenant schema, insert-only for anon/authenticated, readable by super admins.';

create unique index if not exists marketing_leads_email_lower_idx
  on public.marketing_leads (lower(email));

alter table public.marketing_leads enable row level security;

create policy "marketing_leads_insert"
  on public.marketing_leads
  for insert
  to anon, authenticated
  with check (true);

create policy "marketing_leads_select"
  on public.marketing_leads
  for select
  to authenticated
  using (auth_is_super_admin());

