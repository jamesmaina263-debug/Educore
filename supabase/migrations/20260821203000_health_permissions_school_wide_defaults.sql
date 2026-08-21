-- The 2026-08-09 health_module_phase7 migration seeded nurse/leadership
-- health permissions via `cross join schools` -- rows for every school that
-- existed AT THAT TIME, not a true school-wide default (school_id is null).
-- Any school created since (e.g. Gititu High School, 2026-08-21) got none of
-- these rows at all: not health.read_any, not health.write, not
-- students.medical.*, not inventory.read_any for nurse, and no
-- health.read_any default for principal/deputy_principal/school_owner/
-- group_admin either.
--
-- Found via a live case: a nurse at Gititu had several permissions granted
-- individually (health.write, students.medical.read/write, etc.) but the
-- Health module's loader gates its ENTIRE output on health.read_any alone --
-- missing just that one key blanked sick bay, medication, referrals,
-- emergencies, inventory, dashboard stats and reports, despite the other
-- grants being in place.
--
-- Fix: add proper school_id-is-null default rows, matching the correct
-- pattern already used for e.g. school_owner/principal's
-- students.medical.read/write in the 2026-07-29 phase1 migration. Existing
-- schools already have equivalent per-school rows, so this changes nothing
-- for them (role_override still takes precedence over default_grant, same
-- value either way) -- it only fixes schools created after 2026-08-09 and
-- prevents the gap recurring for every school created from here on.

insert into public.role_permissions (role_id, school_id, permission_key, allowed)
select r.id, null, perm.key, true
from public.roles r
cross join (values
  ('health.read_any'),
  ('health.write'),
  ('students.medical.read'),
  ('students.medical.write'),
  ('inventory.read_any')
) as perm(key)
where r.name = 'nurse'
  and not exists (
    select 1 from public.role_permissions rp
    where rp.role_id = r.id and rp.school_id is null and rp.permission_key = perm.key
  );

insert into public.role_permissions (role_id, school_id, permission_key, allowed)
select r.id, null, 'health.read_any', true
from public.roles r
where r.name in ('principal', 'deputy_principal', 'school_owner', 'group_admin')
  and not exists (
    select 1 from public.role_permissions rp
    where rp.role_id = r.id and rp.school_id is null and rp.permission_key = 'health.read_any'
  );
