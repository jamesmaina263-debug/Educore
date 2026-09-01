-- Follow-up to the previous migration: revoking EXECUTE from `anon` directly
-- had no effect because these functions still had EXECUTE granted to
-- PUBLIC (Postgres's default on function creation), and every role
-- (including anon) implicitly inherits PUBLIC's grants. Revoke from PUBLIC
-- and re-grant explicitly to `authenticated` only, for the 5 of the 8
-- flagged functions that are genuinely callable via RPC (the other 3 --
-- auto_enable_staff_biometric_profile, auto_enable_student_biometric_profile,
-- notify_admin_new_demo_request -- return the `trigger` pseudo-type, which
-- Postgres refuses to invoke outside a trigger context regardless of grants,
-- so they're left untouched to avoid any risk to the trigger mechanism
-- itself for zero additional security benefit).
revoke execute on function public.allocate_bed(uuid, uuid) from public;
revoke execute on function public.clear_all_platform_notifications() from public;
revoke execute on function public.log_duplicate_override(uuid, uuid, uuid[]) from public;
revoke execute on function public.log_school_data_export(text[], jsonb) from public;
revoke execute on function public.mark_platform_notification_read(uuid) from public;

grant execute on function public.allocate_bed(uuid, uuid) to authenticated;
grant execute on function public.clear_all_platform_notifications() to authenticated;
grant execute on function public.log_duplicate_override(uuid, uuid, uuid[]) to authenticated;
grant execute on function public.log_school_data_export(text[], jsonb) to authenticated;
grant execute on function public.mark_platform_notification_read(uuid) to authenticated;
