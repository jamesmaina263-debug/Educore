-- The two new permission-request functions (create_permission_requests
-- migration) were left executable by anon/public, unlike every comparable
-- SECURITY DEFINER function elsewhere in this codebase (billing, rollover,
-- fee waivers, user_permission_overrides itself, etc.), all of which
-- explicitly revoke that. Both functions already null-check
-- auth_school_user_id()/auth_school_id() and fail safely for an
-- unauthenticated caller, so this wasn't exploitable today -- but it broke
-- the established hardening convention here.
--
-- Postgres grants EXECUTE to PUBLIC by default on new functions, and anon
-- inherits from PUBLIC -- revoking from anon alone is a no-op (confirmed
-- live via has_function_privilege). Match the actual established pattern
-- (see phase22_user_permission_overrides_revoke_anon,
-- phase0_step2_revoke_anon_execute_explicit): revoke from PUBLIC, revoke
-- from anon explicitly too for clarity, then re-grant to authenticated
-- (both functions are meant to be callable by any signed-in staff member;
-- internal checks -- role/permission lookups, 'already have it' / 'pending
-- request exists' / 'not authorized' / 'can't grant what you don't hold' --
-- govern what actually happens).

revoke execute on function public.request_permission(text, text) from public;
revoke execute on function public.request_permission(text, text) from anon;
grant execute on function public.request_permission(text, text) to authenticated;

revoke execute on function public.respond_to_permission_request(uuid, boolean) from public;
revoke execute on function public.respond_to_permission_request(uuid, boolean) from anon;
grant execute on function public.respond_to_permission_request(uuid, boolean) to authenticated;
