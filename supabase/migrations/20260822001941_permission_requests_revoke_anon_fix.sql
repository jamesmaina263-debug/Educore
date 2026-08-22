-- Follow-up: my prior revoke (permission_requests_revoke_anon) only revoked
-- from the anon role directly, but Postgres grants EXECUTE to PUBLIC by
-- default on new functions, and anon inherits from PUBLIC -- so that revoke
-- was a no-op (confirmed via has_function_privilege still returning true
-- for anon afterwards). Match the actual established pattern in this
-- codebase (see phase22_user_permission_overrides_revoke_anon,
-- phase0_step2_revoke_anon_execute_explicit): revoke from PUBLIC explicitly,
-- then re-grant to authenticated (both functions are meant to be callable
-- by any signed-in staff member; internal checks -- role/permission lookups,
-- 'already have it' / 'pending request exists' / 'not authorized' /
-- 'can't grant what you don't hold' -- govern what actually happens).
revoke execute on function public.request_permission(text, text) from public;
revoke execute on function public.request_permission(text, text) from anon;
grant execute on function public.request_permission(text, text) to authenticated;

revoke execute on function public.respond_to_permission_request(uuid, boolean) from public;
revoke execute on function public.respond_to_permission_request(uuid, boolean) from anon;
grant execute on function public.respond_to_permission_request(uuid, boolean) to authenticated;
