-- Platform admin visibility: last authenticated activity per school, for the "school health"
-- detail on /admin -- see chat/PR notes. Nothing in the public schema tracks logins today
-- (audit_log only records table mutations, see its own comment on the table), and auth.users
-- isn't exposed through PostgREST/the regular client, so a SECURITY DEFINER function is the
-- only way to surface this without adding write-path instrumentation at every place a user
-- can sign in (web app, parent portal, biometric kiosk, etc.).
--
-- Same authorization convention as the billing lifecycle functions (see
-- 20260805034059_billing_lifecycle_functions.sql's module comment): platform staff
-- (auth_is_super_admin()) or the service-role key. No school user, however senior, can see
-- another school's login activity -- this function knows about every school, so unlike a
-- table-level RLS policy the check has to live inside the function body itself.
--
-- One row per school with at least one auth_user_id'd school_users row; last_active_at is
-- null if none of that school's users have ever signed in (last_sign_in_at itself starts
-- null and is only set by GoTrue on a real sign-in) -- never a fabricated "never" vs. an
-- unknown state, the caller can tell the two apart from the row being absent vs. present
-- with a null value.
create or replace function public.admin_school_last_active()
returns table (school_id uuid, last_active_at timestamptz)
language plpgsql
security definer
set search_path to 'public'
as $$
begin
  if not (auth_is_super_admin() or auth.role() = 'service_role') then
    raise exception 'Not authorized to view school activity.';
  end if;

  return query
    select su.school_id, max(u.last_sign_in_at) as last_active_at
    from public.school_users su
    join auth.users u on u.id = su.auth_user_id
    where su.school_id is not null
    group by su.school_id;
end;
$$;

-- Matches the exact "revoke all from public, grant only to authenticated" pattern used by
-- every billing RPC in this project -- anon never has a legitimate reason to call this, and
-- the in-body check above means even an authenticated non-super_admin gets a raised
-- exception rather than data, but keeping the grant narrow is defense in depth regardless.
revoke all on function public.admin_school_last_active() from public;
grant execute on function public.admin_school_last_active() to authenticated;
