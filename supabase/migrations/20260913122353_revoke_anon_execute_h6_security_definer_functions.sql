-- H6: these functions were granted EXECUTE to anon not via an explicit GRANT, but via this
-- project's schema-level default privileges (ALTER DEFAULT PRIVILEGES ... GRANT ALL ON
-- FUNCTIONS TO anon, authenticated, service_role for role postgres/supabase_admin), which
-- fires on every new function created in public. school_has_feature_flag's own migration
-- already did `revoke all ... from public`, which does NOT undo this -- that revoke only
-- strips the PUBLIC pseudo-role's grant, while the default-privileges mechanism grants
-- EXECUTE directly to the anon role by name. Six of these seven (all but
-- protect_schools_sensitive_fields, a trigger function Postgres blocks from direct
-- invocation regardless of grants) are RPC-callable and security definer; each already has
-- an internal auth_is_super_admin()/service_role check, but that check being the only
-- barrier is fragile -- revoking the grant makes the restriction fail closed at the
-- privilege layer instead of relying solely on function-body logic.
revoke execute on function public.admin_update_demo_request_status(uuid, text) from anon;
revoke execute on function public.broadcast_platform_announcement(text, text) from anon;
revoke execute on function public.get_platform_announcement_history() from anon;
revoke execute on function public.log_platform_admin_action(text, jsonb) from anon;
revoke execute on function public.protect_schools_sensitive_fields() from anon;
revoke execute on function public.reactivate_school(uuid) from anon;
revoke execute on function public.school_has_feature_flag(uuid, text) from anon;
