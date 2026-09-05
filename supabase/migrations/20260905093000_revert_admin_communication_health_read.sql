-- Reverts 20260904181526_admin_communication_health_read.sql. Communication delivery health
-- was rebuilt as a per-school tab on the existing /communication page instead of a
-- cross-school platform-admin view (explicit product decision: this is the school's own
-- delivery pipe, not the platform owner's business, and RLS's existing school-scoped clause
-- already covers a school_owner/principal/deputy_principal/bursar viewing their own school's
-- notification_logs -- no super_admin bypass is needed for that). Restoring the exact
-- pre-widening predicate.
alter policy notification_logs_select on public.notification_logs
  using (
    ((school_id = auth_school_id()) AND auth_has_permission('communication.read'))
    or (recipient_school_user_id = (select school_users.id from school_users where school_users.auth_user_id = (select auth.uid())))
    or ((school_id = auth_school_id()) AND (recipient_type = 'supplier') AND auth_has_permission('communication.supplier'))
  );
