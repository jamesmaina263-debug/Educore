-- Full lockdown pass, found during verification of the M-Pesa migration and applied
-- retroactively to the NEMIS functions too for consistency:
-- 1) "revoke all from public" doesn't strip default per-role EXECUTE grants Supabase applies
--    at function-creation time -- explicit per-role revokes needed (codebase precedent:
--    20260728055850_phase0_step2_revoke_anon_execute_explicit.sql).
-- 2) REAL vulnerability found and reproduced live: mpesa_stk_request_dispatched and
--    mpesa_stk_dispatch_failed had no internal ownership check and were granted to
--    authenticated -- an authenticated user from an unrelated school could overwrite another
--    school's pending mpesa_stk_requests row by UUID. Locked to service_role only.

revoke execute on function public.generate_nemis_sync_batch(text, uuid[], text) from anon;
revoke execute on function public.confirm_nemis_sync_batch(uuid) from anon;
revoke execute on function public.reset_student_nemis_status(uuid, text) from anon;
revoke execute on function public.set_mpesa_credentials(text, text, text, text, text, text) from anon;
revoke execute on function public.set_mpesa_active(boolean) from anon;
revoke execute on function public.initiate_mpesa_stk_request(uuid, numeric, text, uuid, text) from anon;

revoke execute on function public.mpesa_stk_request_dispatched(uuid, text, text) from anon, authenticated;
grant execute on function public.mpesa_stk_request_dispatched(uuid, text, text) to service_role;

revoke execute on function public.mpesa_stk_dispatch_failed(uuid, text) from anon, authenticated;
grant execute on function public.mpesa_stk_dispatch_failed(uuid, text) to service_role;
