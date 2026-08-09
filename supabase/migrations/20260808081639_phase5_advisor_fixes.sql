-- Advisor cleanup, matching the existing codebase convention of authenticated-only RPC access
-- (every other auth_*/reporting function is not anon-executable; these three regressed that).

revoke execute on function public.auth_group_id() from public, anon;
grant execute on function public.auth_group_id() to authenticated;

revoke execute on function public.group_schools_summary() from public, anon;
grant execute on function public.group_schools_summary() to authenticated;

revoke execute on function public.issue_api_key(text, text[], uuid, uuid, timestamptz) from public, anon;
grant execute on function public.issue_api_key(text, text[], uuid, uuid, timestamptz) to authenticated;

-- array_all_read_scopes had a mutable search_path (used in a CHECK constraint, so low practical
-- risk, but fixed for consistency with every other function in this schema).
create or replace function public.array_all_read_scopes(p_scopes text[])
returns boolean
language sql
immutable
set search_path to 'public'
as $function$
  select coalesce(bool_and(s like '%.read'), true) from unnest(p_scopes) s
$function$;
