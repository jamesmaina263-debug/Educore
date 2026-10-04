-- Defense in depth for 20261002180000: the self-update branch of school_users_update
-- must also keep school_id equal to the caller's own school. The trigger
-- prevent_school_user_privilege_escalation() remains the primary guard.
-- "is not distinct from" keeps school-less accounts (super_admin / group-level) working.
alter policy school_users_update on public.school_users
  using (
    auth_is_super_admin()
    or (auth_user_id = (select auth.uid()))
    or ((school_id = auth_school_id()) and auth_has_permission('staff.manage'))
  )
  with check (
    auth_is_super_admin()
    or ((auth_user_id = (select auth.uid())) and (school_id is not distinct from auth_school_id()))
    or ((school_id = auth_school_id()) and auth_has_permission('staff.manage'))
  );
