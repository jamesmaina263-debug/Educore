-- Reconstructed from live schema introspection (Supabase project alzqlvfaftwegptfbfej).
-- Original SQL never committed to the repo. Confirmed live via has_function_privilege(): of
-- every SECURITY DEFINER function in `public`, only these four currently have an anon EXECUTE
-- grant — allocate_bed (public self-service bed pick), log_duplicate_override (used from the
-- public admissions flow before a guardian account exists), and the two
-- auto_enable_*_biometric_profile trigger functions (RETURNS trigger, so the grant is inert in
-- practice regardless). Every other SECURITY DEFINER function has no anon grant. This
-- migration confirms that state explicitly rather than leaving it implicit.
--
-- This migration, its two same-day follow-ups (20260826021817, 20260826021848 — both
-- reconstructed as effectively the same idempotent sweep), and
-- 20260826024031_default_privileges_no_public_execute_on_functions.sql together lock this
-- down. Revoking an already-revoked privilege is a no-op, so replaying this against the
-- current live state is safe.

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
