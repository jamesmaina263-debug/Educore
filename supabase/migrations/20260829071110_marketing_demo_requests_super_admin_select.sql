-- Marketing site: allow platform super admins to read marketing_demo_requests
-- through the app (Analytics & Marketing admin console), not just via
-- Supabase Studio.
--
-- This does NOT relax the existing insert-only posture for anon/authenticated
-- visitors -- the "marketing_demo_requests_insert" policy from the Phase 8
-- migration is untouched. This adds one new, separate SELECT policy, gated
-- by auth_is_super_admin() (the same helper already used to gate
-- /admin/whitelabel and /admin/billing), so only platform staff -- never a
-- school user -- can read submitted leads through the app.
create policy "marketing_demo_requests_select_super_admin"
  on public.marketing_demo_requests
  for select
  to authenticated
  using (auth_is_super_admin());

comment on policy "marketing_demo_requests_select_super_admin" on public.marketing_demo_requests is
  'Read access for the platform Analytics & Marketing admin console. Gated to auth_is_super_admin() -- school users cannot read this table under any policy.';
