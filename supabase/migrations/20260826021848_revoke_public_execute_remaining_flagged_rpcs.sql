-- Reconstructed from live schema introspection (Supabase project alzqlvfaftwegptfbfej).
-- Original SQL never committed to the repo. Confirmed live via has_function_privilege(): no
-- SECURITY DEFINER function in `public` currently has an EXECUTE grant to the PUBLIC
-- pseudo-role (the four exceptions carrying an anon grant — see
-- 20260826021559_revoke_anon_execute_from_authenticated_only_rpcs.sql — do not carry a
-- separate PUBLIC grant). This migration confirms that state explicitly.

DO $$
DECLARE
  v_fn record;
BEGIN
  FOR v_fn IN
    SELECT p.oid, p.proname, pg_get_function_identity_arguments(p.oid) AS args
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public'
      AND p.prosecdef = true
  LOOP
    EXECUTE format('REVOKE EXECUTE ON FUNCTION public.%I(%s) FROM PUBLIC', v_fn.proname, v_fn.args);
  END LOOP;
END $$;
