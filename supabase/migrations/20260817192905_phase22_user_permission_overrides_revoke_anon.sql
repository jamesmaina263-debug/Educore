-- Postgres grants EXECUTE to PUBLIC by default on new functions, which
-- includes the anon role. Every other helper function in this codebase
-- explicitly locks that down (see phase0_step2_revoke_anon_execute_explicit,
-- rollover_function_revoke_anon, etc.) -- match that pattern for the two
-- new functions from phase22.

revoke execute on function public.auth_school_user_id() from public;
revoke execute on function public.auth_school_user_id() from anon;
grant execute on function public.auth_school_user_id() to authenticated;

revoke execute on function public.enforce_user_permission_override_school_match() from public;
revoke execute on function public.enforce_user_permission_override_school_match() from anon;
-- trigger functions don't need direct EXECUTE by client roles, they run
-- under the table owner via the trigger mechanism -- but pin it down anyway
-- for consistency with how every other function in this project is treated.
