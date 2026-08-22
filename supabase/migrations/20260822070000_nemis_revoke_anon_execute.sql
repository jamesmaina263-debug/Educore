-- Follow-up to 20260821112851_nemis_integration.sql (found and fixed during verification of
-- the later M-Pesa migration, applied to the same three NEMIS functions for consistency).
--
-- "revoke all from public" alone doesn't strip the default per-role EXECUTE grant Supabase
-- applies to anon at function-creation time -- codebase precedent
-- (20260728055850_phase0_step2_revoke_anon_execute_explicit.sql) is to revoke it explicitly.
-- Not exploitable here (auth_has_permission itself is anon-locked, so an anon caller hits a
-- lower-level 42501 before reaching any of these functions' own logic), but matching the
-- established convention rather than relying on that indirection.
revoke execute on function public.generate_nemis_sync_batch(text, uuid[], text) from anon;
revoke execute on function public.confirm_nemis_sync_batch(uuid) from anon;
revoke execute on function public.reset_student_nemis_status(uuid, text) from anon;
