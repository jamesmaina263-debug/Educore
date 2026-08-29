-- Phase 11 (marketing site, feature/marketing-site branch): first-touch
-- marketing attribution for demo-request leads.
--
-- Three nullable columns on the same isolated, insert-only-RLS table added
-- in the Phase 8 migration -- no new table, no RLS policy change (the
-- existing "marketing_demo_requests_insert" policy already covers every
-- column via `with check (true)`), no FK into the tenant schema, still not
-- readable by anon/authenticated. Values are populated client-side from
-- UTM query params captured on landing (see src/lib/attribution.ts) and
-- forwarded through the form as hidden fields -- never visitor-entered, so
-- there's nothing here that needs stronger validation than length-capping,
-- already done in src/app/(marketing)/contact/actions.ts.
alter table public.marketing_demo_requests
  add column if not exists utm_source text,
  add column if not exists utm_medium text,
  add column if not exists utm_campaign text;

comment on column public.marketing_demo_requests.utm_source is
  'First-touch UTM source captured client-side on landing (e.g. "google", "facebook"). Null if the visitor arrived without UTM params.';
comment on column public.marketing_demo_requests.utm_medium is
  'First-touch UTM medium captured client-side on landing (e.g. "cpc", "social"). Null if the visitor arrived without UTM params.';
comment on column public.marketing_demo_requests.utm_campaign is
  'First-touch UTM campaign captured client-side on landing. Null if the visitor arrived without UTM params.';
