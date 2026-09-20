-- Google Ads readiness: store enough attribution to tell which ads bring in
-- real customers.
--
-- 1) Five more nullable columns on each public lead table -- the two UTM tags
--    that were not captured (utm_term, utm_content) and Google's ad click IDs
--    (gclid, gbraid, wbraid). Additive only: no RLS/policy change (the existing
--    insert-only policies already cover every column via `with check (true)`),
--    no default, no backfill, no effect on existing rows or queries. Values are
--    filled from URL parameters by browser code (src/lib/attribution.ts),
--    sanitised in src/lib/marketing/attribution-fields.ts, and only ever
--    describe which channel gets credit -- they never gate a submission.
--
-- 2) marketing_signup_attribution: the same fields for self-serve trial
--    signups, in its own table so nothing about the tenant `schools` table
--    changes. One row per school (primary key = school_id), written best-effort
--    by the signUpSchool server action with the service role AFTER the school,
--    owner and trial subscription already exist, so a failure here can never
--    affect a signup. RLS is enabled with no policies and the table grants are
--    revoked from anon/authenticated, so it is unreachable from the browser and
--    the app; read it with the service role / Supabase SQL editor when
--    reporting paid customers back to Google Ads as offline conversions.
--    Deleting a school removes its row (ON DELETE CASCADE).
--
-- Every statement is idempotent (`if not exists`).

alter table public.marketing_demo_requests
  add column if not exists utm_term text,
  add column if not exists utm_content text,
  add column if not exists gclid text,
  add column if not exists gbraid text,
  add column if not exists wbraid text;

alter table public.marketing_leads
  add column if not exists utm_term text,
  add column if not exists utm_content text,
  add column if not exists gclid text,
  add column if not exists gbraid text,
  add column if not exists wbraid text;

comment on column public.marketing_demo_requests.gclid is
  'Google Ads click ID (auto-tagging) captured client-side on landing, only when the visitor had not declined cookies. Null otherwise.';
comment on column public.marketing_leads.gclid is
  'Google Ads click ID (auto-tagging) captured client-side on landing, only when the visitor had not declined cookies. Null otherwise.';

create table if not exists public.marketing_signup_attribution (
  school_id uuid primary key references public.schools (id) on delete cascade,
  created_at timestamptz not null default now(),
  utm_source text,
  utm_medium text,
  utm_campaign text,
  utm_term text,
  utm_content text,
  gclid text,
  gbraid text,
  wbraid text
);

comment on table public.marketing_signup_attribution is
  'First-touch marketing attribution (UTM tags, Google Ads click ID) for self-serve trial signups. Written by signUpSchool with the service role; not readable by anon/authenticated. Use for offline-conversion reporting to Google Ads.';

alter table public.marketing_signup_attribution enable row level security;

revoke all on table public.marketing_signup_attribution from anon, authenticated;
