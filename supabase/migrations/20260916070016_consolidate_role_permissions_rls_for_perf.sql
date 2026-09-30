-- Part 22. role_permissions had 2 ALL-cmd permissive policies
-- (override_manage + write_super_admin); merged. Select policy untouched.
-- Extra care noted: role_permissions governs what each role can DO, which
-- is adjacent to (though a different table from) the school_users role_id
-- table involved in the 2026-08-26 privilege-escalation fix. Neither
-- original policy here references role names or a role hierarchy -- both
-- are simple, independent permission checks (school-scoped
-- settings.roles.manage, or global super_admin) with no column that could
-- interact unsafely when OR'd together. Applied directly to production via
-- Supabase MCP during the audit and verified live.
drop policy role_permissions_override_manage on public.role_permissions;
drop policy role_permissions_write_super_admin on public.role_permissions;
create policy role_permissions_write on public.role_permissions
  for all
  using (
    (school_id = auth_school_id() and auth_has_permission('settings.roles.manage'))
    or auth_is_super_admin()
  )
  with check (
    (school_id = auth_school_id() and auth_has_permission('settings.roles.manage'))
    or auth_is_super_admin()
  );
