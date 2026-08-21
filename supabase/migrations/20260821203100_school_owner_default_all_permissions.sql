-- Lucy's explicit instruction (2026-08-21): school_owner should hold every
-- permission by default, not just the ~60 keys it happened to accumulate
-- piecemeal across prior migrations. Grants a true school_id-is-null
-- default (same mechanism as every other default grant, not a hardcoded
-- bypass in auth_has_permission()) for every permission_key currently known
-- to the system -- pulled from what's actually in use (role_permissions +
-- user_permission_overrides) rather than a hand-maintained list, so nothing
-- gets missed.
--
-- This still leaves room to narrow a specific owner later if ever needed:
-- a school-scoped role_permissions row or a per-user override both still
-- take precedence over this default (see auth_has_permission()'s
-- coalesce order), same as for every other role.
--
-- Note: this includes group.branding.write / group.reports.read (group-
-- level, multi-campus permissions previously only granted to group_admin).
-- A school_owner not part of any school_group has no group to apply these
-- to, so it's a no-op for them today -- but for an owner whose school IS in
-- a group, this does now also hand them group-wide branding/report access
-- by default, not just their own school's. Flagging in case that's narrower
-- than intended once multi-campus groups are actually in use.

insert into public.role_permissions (role_id, school_id, permission_key, allowed)
select r.id, null, known.permission_key, true
from public.roles r
cross join (
  select distinct permission_key from public.role_permissions
  union
  select distinct permission_key from public.user_permission_overrides
) as known
where r.name = 'school_owner'
  and not exists (
    select 1 from public.role_permissions rp
    where rp.role_id = r.id and rp.school_id is null and rp.permission_key = known.permission_key
  );
