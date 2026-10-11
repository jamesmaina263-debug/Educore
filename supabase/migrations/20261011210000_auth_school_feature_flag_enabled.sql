-- App-facing wrapper for per-school feature flags, mirroring auth_school_module_enabled(p_key).
--
-- school_has_feature_flag(p_school_id, p_key) was revoked from `authenticated` on 2026-10-02
-- (20261002200000_revoke_cross_school_lookup_rpcs.sql) because it takes any school id and so
-- let a signed-in user read another school's flags. This wrapper derives the caller's own school
-- internally via auth_school_id(), so it can only ever answer for the caller's school.
--
-- It is SECURITY DEFINER (owner-executed), so the revoke on school_has_feature_flag does not
-- affect it. Unknown key or no override row both read as false (feature stays off).
create or replace function public.auth_school_feature_flag_enabled(p_key text)
returns boolean
language sql
stable
security definer
set search_path to 'public'
as $$
  select public.school_has_feature_flag(auth_school_id(), p_key);
$$;

revoke all on function public.auth_school_feature_flag_enabled(text) from public, anon;
grant execute on function public.auth_school_feature_flag_enabled(text) to authenticated;
