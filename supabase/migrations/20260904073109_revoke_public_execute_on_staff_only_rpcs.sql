-- Reconciliation: already live in production (applied 2026-09-04), never committed -- caught by
-- the migration drift check. Content copied verbatim from supabase_migrations.schema_migrations.
--
-- Follow-up to revoke_anon_execute_on_staff_only_rpcs: the prior migration
-- revoked EXECUTE FROM anon, but 8 of the 11 functions had EXECUTE granted to
-- PUBLIC (the implicit "everyone" grant Postgres assigns by default on
-- CREATE FUNCTION), which anon inherits regardless of an anon-specific
-- revoke. Revoking FROM PUBLIC removes that inheritance. authenticated and
-- service_role keep their existing explicit grants untouched, so
-- authenticated app behavior is unaffected.

revoke execute on function public.auto_enable_staff_biometric_profile() from public;
revoke execute on function public.auto_enable_student_biometric_profile() from public;
revoke execute on function public.notify_admin_new_demo_request() from public;
revoke execute on function public.issue_health_stock(uuid, integer, text, uuid) from public;
revoke execute on function public.issue_library_loan(uuid, uuid, date, uuid) from public;
revoke execute on function public.issue_library_loan_to_staff(uuid, uuid, date, uuid) from public;
revoke execute on function public.log_school_data_import(text[], jsonb) from public;
revoke execute on function public.record_stock_movement(uuid, text, integer, text, uuid) from public;

-- These four are trigger-only or authenticated-only functions that lost
-- their PUBLIC grant above but still need to run: triggers execute as the
-- function's SECURITY DEFINER owner regardless of caller grants, so this
-- does not affect trigger firing. Explicit grants below are just documentation
-- of intent for the two that should remain directly callable by staff.
grant execute on function public.issue_health_stock(uuid, integer, text, uuid) to authenticated;
grant execute on function public.issue_library_loan(uuid, uuid, date, uuid) to authenticated;
grant execute on function public.issue_library_loan_to_staff(uuid, uuid, date, uuid) to authenticated;
grant execute on function public.log_school_data_import(text[], jsonb) to authenticated;
grant execute on function public.record_stock_movement(uuid, text, integer, text, uuid) to authenticated;
