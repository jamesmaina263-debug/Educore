-- The two new permission-request functions (create_permission_requests
-- migration) were left executable by anon, unlike every comparable
-- SECURITY DEFINER function elsewhere in this codebase (billing, rollover,
-- fee waivers, user_permission_overrides itself, etc.), all of which
-- explicitly revoke anon execute. Both functions already null-check
-- auth_school_user_id()/auth_school_id() and fail safely for an
-- unauthenticated caller, so this isn't exploitable today -- but it breaks
-- the established hardening convention here, so closing it to match.
revoke execute on function public.request_permission(text, text) from anon;
revoke execute on function public.respond_to_permission_request(uuid, boolean) from anon;
