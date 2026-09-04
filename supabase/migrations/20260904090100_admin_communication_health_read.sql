-- Platform admin gap: notification_logs (every SMS/email/WhatsApp dispatch attempt, across
-- every school) has no super_admin read path today -- notification_logs_select is
-- school-scoped only, unlike platform_invoices/school_subscriptions which already carry an
-- `auth_is_super_admin() OR (school-scoped check)` clause (see 20260805034029). That's the
-- exact convention this migration extends to notification_logs, so platform staff can see
-- delivery health (queue depth, failed dispatches, per-channel success rate) across all
-- schools from /admin/communication, the same way they already see billing across all schools
-- from /admin/billing.
--
-- Re-stating the policy's current predicate in full (from 20260903061901's initplan-perf
-- pass) and OR-ing in auth_is_super_admin() -- nothing else about the policy changes, so
-- every existing reader (school staff with communication.read, a recipient looking up their
-- own row, supplier-scoped readers) keeps exactly the access they had.
alter policy notification_logs_select on public.notification_logs
  using (
    auth_is_super_admin()
    or ((school_id = auth_school_id()) AND auth_has_permission('communication.read'))
    or (recipient_school_user_id = (select school_users.id from school_users where school_users.auth_user_id = (select auth.uid())))
    or ((school_id = auth_school_id()) AND (recipient_type = 'supplier') AND auth_has_permission('communication.supplier'))
  );
