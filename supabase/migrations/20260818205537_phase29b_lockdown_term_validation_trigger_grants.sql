-- Trigger functions can't be called directly via RPC anyway (Postgres rejects
-- non-trigger invocation), but revoke authenticated's default EXECUTE grant
-- too so these don't show up as callable RPC endpoints in the API surface,
-- matching the lockdown pattern used elsewhere in this codebase
-- (e.g. exams_function_privilege_lockdown, finance_trigger_function_lockdown).
REVOKE ALL ON FUNCTION public.validate_term_mutation() FROM authenticated;
REVOKE ALL ON FUNCTION public.validate_academic_year_mutation() FROM authenticated;
