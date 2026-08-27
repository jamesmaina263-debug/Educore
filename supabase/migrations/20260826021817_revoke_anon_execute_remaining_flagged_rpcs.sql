-- Reconstructed from live schema introspection (Supabase project alzqlvfaftwegptfbfej).
-- Original SQL never committed to the repo. Same-day follow-up to
-- 20260826021559_revoke_anon_execute_from_authenticated_only_rpcs.sql — the name suggests a
-- second pass catching functions the first sweep missed. Since the first (reconstructed) file
-- already covers every SECURITY DEFINER function in `public` via a dynamic loop, this file
-- re-applies the identical sweep; REVOKE on an already-revoked privilege is a no-op, so
-- running it twice is safe and keeps the version history complete.

DO $$
DECLARE
  v_fn record;
  v_allowlist text[] := ARRAY[
    'allocate_bed', 'auto_enable_staff_biometric_profile',
    'auto_enable_student_biometric_profile', 'log_duplicate_override'
  ];
BEGIN
  FOR v_fn IN
    SELECT p.oid, p.proname, pg_get_function_identity_arguments(p.oid) AS args
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public'
      AND p.prosecdef = true
      AND p.proname <> ALL (v_allowlist)
  LOOP
    EXECUTE format('REVOKE EXECUTE ON FUNCTION public.%I(%s) FROM anon', v_fn.proname, v_fn.args);
  END LOOP;
END $$;
