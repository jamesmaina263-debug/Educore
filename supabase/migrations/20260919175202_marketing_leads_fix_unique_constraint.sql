-- Corrects 20260919175031_marketing_leads.sql: a case-insensitive
-- expression index on lower(email) can't be used as an upsert onConflict
-- target via PostgREST/supabase-js -- that API only accepts a target
-- matching an actual constraint or a plain-column index. The application
-- (src/app/(marketing)/lead-magnet-actions.ts) now lowercases email before
-- insert, so a plain unique constraint on the raw column achieves the same
-- practical de-duplication while matching what the client library can
-- actually target.
drop index if exists public.marketing_leads_email_lower_idx;
alter table public.marketing_leads add constraint marketing_leads_email_key unique (email);
