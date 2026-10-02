-- LOW (info disclosure): school_has_feature_flag(p_school_id, p_key) and
-- school_module_enabled(p_school_id, p_key) are SECURITY DEFINER, take any school id, and
-- have no check that it is the caller's school -- yet were executable by every
-- authenticated user. Any signed-in user at any school could therefore read another
-- school's feature-flag / module settings by supplying its uuid.
--
-- Nothing needs them directly as `authenticated`:
--   * src/ never calls either one (the app uses auth_school_module_enabled(p_key)).
--   * The only database object that references them is auth_school_module_enabled(), which
--     is itself SECURITY DEFINER (owner-executed), so it is unaffected by this revoke.
--   * No RLS policy, trigger, view, column default or CHECK constraint references them
--     (verified against the live schema).
--   * service_role keeps EXECUTE (explicitly re-granted below).
--
-- (generate_admission_number(uuid), noted in the audit, no longer exists in the live DB --
-- dropped by 20260812041708 -- so it needs no action.)
--
-- Rollback, if ever needed:
--   grant execute on function public.school_has_feature_flag(uuid, text) to authenticated;
--   grant execute on function public.school_module_enabled(uuid, text) to authenticated;

revoke execute on function public.school_has_feature_flag(uuid, text) from public, anon, authenticated;
revoke execute on function public.school_module_enabled(uuid, text) from public, anon, authenticated;

grant execute on function public.school_has_feature_flag(uuid, text) to service_role;
grant execute on function public.school_module_enabled(uuid, text) to service_role;
