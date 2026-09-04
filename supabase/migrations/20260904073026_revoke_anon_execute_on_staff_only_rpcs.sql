-- Reconciliation: already live in production (applied 2026-09-04), never committed -- caught by
-- the migration drift check. Content copied verbatim from supabase_migrations.schema_migrations.
--
-- Security advisor flagged 11 SECURITY DEFINER functions as EXECUTE-able by
-- the `anon` role. Verified none are actually exploitable: each business-logic
-- function gates on auth_has_permission()/auth_school_id(), both of which
-- resolve to false/null when auth.uid() is null (unauthenticated), so an anon
-- caller always hits `insufficient permissions`. The three trigger-only
-- functions (auto_enable_staff_biometric_profile,
-- auto_enable_student_biometric_profile, notify_admin_new_demo_request) fire
-- as their owner regardless of EXECUTE grants, so revoking direct-call
-- privilege does not affect trigger behavior.
--
-- This is defense-in-depth, not a live-vuln fix: removing the default
-- PUBLIC/anon EXECUTE grant so these can only be reached through an
-- authenticated session, matching least-privilege and clearing the advisor.

revoke execute on function public.auto_enable_staff_biometric_profile() from anon;
revoke execute on function public.auto_enable_student_biometric_profile() from anon;
revoke execute on function public.notify_admin_new_demo_request() from anon;
revoke execute on function public.dismiss_knec_cba_window_reminder(uuid) from anon;
revoke execute on function public.issue_health_stock(uuid, integer, text, uuid) from anon;
revoke execute on function public.issue_library_loan(uuid, uuid, date, uuid) from anon;
revoke execute on function public.issue_library_loan_to_staff(uuid, uuid, date, uuid) from anon;
revoke execute on function public.log_school_data_import(text[], jsonb) from anon;
revoke execute on function public.record_stock_movement(uuid, text, integer, text, uuid) from anon;
revoke execute on function public.set_knec_cba_reminders_enabled(boolean) from anon;
revoke execute on function public.update_knec_cba_export_columns(jsonb) from anon;
