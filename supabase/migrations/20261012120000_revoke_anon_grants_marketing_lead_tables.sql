-- Defence in depth: the public/anonymous role has no business holding privileges on the
-- marketing lead tables or the platform staff list.
--
-- State before this migration (checked read-only against production):
--   * RLS is enabled on all four tables and the only policy on each is a SELECT limited to
--     auth_is_super_admin(), so anon could not read any row today.
--   * anon nevertheless held table-level SELECT / TRIGGER / REFERENCES, and authenticated held
--     TRIGGER / REFERENCES, left over from Supabase's default grants. If RLS were ever disabled
--     or a permissive policy added by mistake, those grants would expose lead names, phone
--     numbers and emails to the open internet.
--
-- Why this is safe:
--   * Every write goes through the service-role client (contact/actions.ts, lead-magnet-actions.ts,
--     partial-lead store); service_role is untouched.
--   * Every read is an admin page that first requires a signed-in super-admin and then queries
--     as `authenticated`; authenticated keeps SELECT (still gated by the RLS policies).
--   * Foreign keys (e.g. marketing_demo_requests.assigned_to -> platform_team_members) are
--     enforced with the table owner's privileges, not the caller's, so REFERENCES is not needed
--     at runtime.
--   * Trigger functions that notify admins are SECURITY DEFINER.
--
-- Deliberately NOT changed: the `schools` table (anon grants there are a separate decision that
-- needs a review of every public page), and authenticated SELECT on these tables.
--
-- REVOKE is idempotent: running it twice, or on a database that never had the grant, is a no-op.

revoke all on table public.marketing_demo_requests from anon;
revoke all on table public.marketing_demo_partial_leads from anon;
revoke all on table public.marketing_leads from anon;
revoke all on table public.platform_team_members from anon;

revoke trigger, references on table public.marketing_demo_requests from authenticated;
revoke trigger, references on table public.marketing_demo_partial_leads from authenticated;
revoke trigger, references on table public.marketing_leads from authenticated;
revoke trigger, references on table public.platform_team_members from authenticated;
