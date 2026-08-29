-- Marketing site funnel spec requires the admin console to surface "Demo
-- Requests" and the funnel's final stages. `marketing_demo_requests` was
-- deliberately insert-only (see 20260828203537_marketing_demo_requests.sql)
-- so submissions were readable only via Supabase Studio's service-role
-- access. This adds a scoped read path for the app instead, gated the same
-- way the existing platform-admin tables are (billing_core_schema.sql:
-- `for select to authenticated using (auth_is_super_admin() or ...)`).
-- This table isn't scoped to any school, so there's no
-- `school_id = auth_school_id()` clause to add -- super admin only.
create policy "marketing_demo_requests_select"
  on public.marketing_demo_requests
  for select
  to authenticated
  using (auth_is_super_admin());
