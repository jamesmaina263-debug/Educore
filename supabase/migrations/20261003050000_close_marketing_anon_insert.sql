-- M1 step 2 of 2: close the anonymous / direct-PostgREST write path on the two marketing
-- tables. Anyone holding the public anon key could previously INSERT rows straight into
-- marketing_leads / marketing_demo_requests (policies `WITH CHECK (true)` to anon +
-- authenticated), bypassing Turnstile, the honeypot and the per-IP rate limits.
--
-- Safe ONLY because both writers now use the service-role admin client, which bypasses
-- RLS and holds its own grants:
--   * submitDemoRequest  (src/app/(marketing)/contact/actions.ts)  -- PR #516, deployed
--   * submitLeadMagnet   (src/app/(marketing)/lead-magnet-actions.ts) -- PR #518, deployed
-- No other code path writes either table (src/, supabase/functions, scripts, loadtest).
-- The admin pages only SELECT. The notify_admin_* triggers are SECURITY DEFINER, so they
-- fire identically regardless of the inserting role.
--
-- Left untouched on purpose: the *_select policies (super_admin reads) and SELECT grants.
-- Scope is these two tables only; the schema-wide anon-grant cleanup is M2.
--
-- Rollback (restores the old, insecure behavior -- only if a regression is found):
--   create policy marketing_leads_insert on public.marketing_leads
--     for insert to anon, authenticated with check (true);
--   create policy marketing_demo_requests_insert on public.marketing_demo_requests
--     for insert to anon, authenticated with check (true);
--   grant insert on public.marketing_leads, public.marketing_demo_requests to anon, authenticated;

drop policy if exists marketing_leads_insert on public.marketing_leads;
drop policy if exists marketing_demo_requests_insert on public.marketing_demo_requests;

revoke insert, update, delete on public.marketing_leads from anon, authenticated;
revoke insert, update, delete on public.marketing_demo_requests from anon, authenticated;
