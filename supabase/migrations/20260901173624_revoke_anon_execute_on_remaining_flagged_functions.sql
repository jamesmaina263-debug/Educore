-- Security hardening (defense-in-depth, least privilege):
-- These 8 functions were flagged by the Supabase security advisor as
-- SECURITY DEFINER + executable by the `anon` role. Each was individually
-- verified safe (all 6 callable ones fail closed via auth_has_permission()/
-- auth_is_super_admin()/auth_school_id(), which resolve to false/null when
-- auth.uid() is null under the anon role; the other 2 are trigger functions
-- Postgres won't invoke outside a trigger context regardless of grants).
-- anon never has a legitimate reason to call any of them directly, so revoke
-- EXECUTE to remove the unnecessary attack surface, matching the pattern
-- already used for other RPCs in this project (see prior
-- revoke_anon_execute_* migrations).
revoke execute on function public.allocate_bed(uuid, uuid) from anon;
revoke execute on function public.auto_enable_staff_biometric_profile() from anon;
revoke execute on function public.auto_enable_student_biometric_profile() from anon;
revoke execute on function public.clear_all_platform_notifications() from anon;
revoke execute on function public.log_duplicate_override(uuid, uuid, uuid[]) from anon;
revoke execute on function public.log_school_data_export(text[], jsonb) from anon;
revoke execute on function public.mark_platform_notification_read(uuid) from anon;
revoke execute on function public.notify_admin_new_demo_request() from anon;
