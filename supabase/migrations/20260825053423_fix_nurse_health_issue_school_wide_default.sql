-- Real, currently-live bug: the Nurse at Gititu High School (created
-- 2026-08-17) cannot accept a Main Store -> Health transfer or issue stock
-- to a student at all -- both accept_inventory_transfer and issue_health_stock
-- (20260813230000) hard-require inventory.health.issue and raise an
-- exception without it.
--
-- Root cause: 20260813230000 granted inventory.health.issue to the Nurse
-- role via a per-school loop (`cross join schools s ... school_id = s.id`),
-- not a school-wide default (school_id is null). That loop only ever ran
-- once, covering only the schools that existed at the time (in effect, just
-- Demo Academy) -- no trigger, no default, nothing covers a school created
-- afterward. Every school created since 2026-08-13 has a Nurse role with
-- this permission simply missing, not merely unset.
--
-- This is the same class of bug as the missing 'Medical Supplies' category
-- fixed in 20260824115310 (seed_default_inventory_categories) -- a one-off
-- per-school backfill with nothing covering schools created afterward --
-- just surfaced later because it only breaks once a school actually tries
-- to receive a transfer or issue stock, not at signup.
--
-- Fix, matching the correct pattern already established elsewhere
-- (20260821201515 health_permissions_school_wide_defaults,
-- 20260824170000 nurse_procurement_request): grant as a single school-wide
-- default (school_id is null) so it applies to every school automatically,
-- current and future, via auth_has_permission()'s existing default-grant
-- fallback -- no per-school loop, no trigger needed at all, since this is a
-- role permission, not per-school data.

insert into public.role_permissions (role_id, school_id, permission_key, allowed)
select r.id, null, 'inventory.health.issue', true
from public.roles r
where r.name = 'nurse'
  and not exists (
    select 1 from public.role_permissions rp
    where rp.role_id = r.id and rp.school_id is null and rp.permission_key = 'inventory.health.issue'
  );
