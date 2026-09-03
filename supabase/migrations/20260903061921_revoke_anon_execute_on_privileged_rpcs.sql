-- These SECURITY DEFINER functions already self-check auth_has_permission()/auth_is_super_admin(),
-- which fail closed for the anon role (auth.uid() is null -> no school_users row -> false).
-- So this was not an exploitable bypass. But granting EXECUTE to anon on staff-only operations
-- (issuing stock, library loans, generating KNEC exam export batches, etc.) is unnecessary
-- attack surface: it lets unauthenticated clients enumerate/probe these endpoints over
-- PostgREST, and it means any *future* function that forgets an internal permission check
-- is instantly exploitable by anyone on the internet, with no second line of defense.
-- Revoking anon leaves `authenticated` (the intended caller set) untouched.

revoke execute on function public.admin_school_last_active() from anon;
revoke execute on function public.confirm_knec_cba_export_batch(uuid) from anon;
revoke execute on function public.generate_knec_cba_export_batch(uuid, uuid, uuid[], text) from anon;
revoke execute on function public.issue_health_stock(uuid, integer, text, uuid) from anon;
revoke execute on function public.issue_library_loan(uuid, uuid, date, uuid) from anon;
revoke execute on function public.issue_library_loan_to_staff(uuid, uuid, date, uuid) from anon;
revoke execute on function public.log_school_data_import(text[], jsonb) from anon;
revoke execute on function public.record_stock_movement(uuid, text, integer, text, uuid) from anon;
revoke execute on function public.reset_knec_cba_export_item(uuid, text) from anon;

-- Trigger functions: never meant to be called directly via RPC at all (they run in a
-- trigger context, not a client request context). No role needs direct EXECUTE.
revoke execute on function public.auto_enable_staff_biometric_profile() from anon, authenticated;
revoke execute on function public.auto_enable_student_biometric_profile() from anon, authenticated;
revoke execute on function public.notify_admin_new_demo_request() from anon, authenticated;
