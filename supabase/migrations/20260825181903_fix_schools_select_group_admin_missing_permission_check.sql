-- Fix inconsistent access control: schools_select_group_admin let any user with the
-- group_admin role read every school row in their group (including kra_pin,
-- expense_approval_threshold, fee_alert_threshold, nemis_institution_code) with no
-- permission gate. Every other cross-school access path -- school_groups_select_privileged
-- on the sibling school_groups table, and the group_schools_summary() RPC that the
-- campuses page actually uses -- requires group.branding.write or group.reports.read
-- in addition to holding the group_admin role. Align this policy with that established
-- pattern so a group_admin whose permissions were deliberately narrowed via
-- user_permission_overrides can't bypass that narrowing by querying the table directly.

drop policy if exists schools_select_group_admin on public.schools;

create policy schools_select_group_admin on public.schools
  for select
  using (
    (school_group_id = auth_group_id())
    and (auth_has_permission('group.branding.write') or auth_has_permission('group.reports.read'))
  );
