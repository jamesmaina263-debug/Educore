-- Bug found: decideRequisitionAction's outcome notification ("your request was
-- approved/rejected") always points action_url at /inventory/procurement.
-- That's correct for a Main Store requester (inventory.read_any), but the
-- Nurse (health.procurement.request, no inventory.read_any -- see
-- 20260824170000/20260824160000) would click it and hit a "no access" page.
-- Her own status view is /health/inventory instead.
--
-- Fix needs a way to check *someone else's* effective permission (the
-- requester's, not the caller/approver's) -- auth_has_permission only ever
-- checks the calling session. This mirrors its exact precedence
-- (user override > school-level role override > role default > false), just
-- parameterized on a target school_user instead of auth.uid(), and scoped so
-- it can only ever be checked for someone in the caller's own school (same
-- safety boundary notify_school_user already uses).
create or replace function public.school_user_has_permission(p_school_user_id uuid, p_permission_key text)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  with target as (
    select su.id as school_user_id, su.school_id, su.role_id
    from school_users su
    where su.id = p_school_user_id
      and su.school_id = auth_school_id()
    limit 1
  ),
  user_override as (
    select upo.allowed
    from user_permission_overrides upo, target t
    where upo.school_user_id = t.school_user_id
      and upo.permission_key = p_permission_key
  ),
  role_override as (
    select rp.allowed
    from role_permissions rp, target t
    where rp.role_id = t.role_id
      and rp.school_id = t.school_id
      and rp.permission_key = p_permission_key
  ),
  default_grant as (
    select rp.allowed
    from role_permissions rp, target t
    where rp.role_id = t.role_id
      and rp.school_id is null
      and rp.permission_key = p_permission_key
  )
  select coalesce(
    (select allowed from user_override),
    (select allowed from role_override),
    (select allowed from default_grant),
    false
  );
$$;

comment on function public.school_user_has_permission(uuid, text) is
  'Same precedence as auth_has_permission(), but for a target school_user rather than the caller -- e.g. deciding which page a notification should link to based on what its recipient can actually see. Only resolves for a target in the caller''s own school; returns false (not an error) otherwise, since a missing/foreign target should just fail the permission check, not the caller''s action.';

revoke all on function public.school_user_has_permission(uuid, text) from public, anon;
grant execute on function public.school_user_has_permission(uuid, text) to authenticated;
