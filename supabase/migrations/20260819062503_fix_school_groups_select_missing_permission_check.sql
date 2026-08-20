-- school_groups_select_group_admin's name implies group_admin scoping, but its USING
-- clause only checked `id = auth_group_id()` -- group membership, no permission check at
-- all. Every other RLS policy in this codebase layers auth_has_permission(...) alongside
-- scope (see api_keys_select, school_groups_update_group_admin itself, group_schools_summary's
-- own internal check) -- this was the one exception, meaning any staff member (teacher,
-- bursar, etc.) at a school belonging to a group could see the group's branding data
-- (logo, colors, custom domain, whitelabel status) even without any group-admin permission.
-- Not currently live-exploitable -- zero schools belong to any group in production today --
-- but a real, latent scope gap. Gated on group.branding.write OR group.reports.read (both
-- currently held only by group_admin, so zero live behavior change for the one role that
-- actually uses this) instead of inventing a new permission key for a single SELECT policy.
DROP POLICY IF EXISTS school_groups_select_group_admin ON public.school_groups;

CREATE POLICY school_groups_select_group_admin
ON public.school_groups
FOR SELECT
USING (
  id = public.auth_group_id()
  AND (public.auth_has_permission('group.branding.write') OR public.auth_has_permission('group.reports.read'))
);
