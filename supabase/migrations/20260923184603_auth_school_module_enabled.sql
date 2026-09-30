-- Convenience wrapper mirroring auth_has_permission(p_permission_key)'s shape: derives the
-- caller's own school internally (via auth_school_id(), the existing helper every school-scoped
-- RLS policy already uses) so app code can call this in a single parallel RPC alongside
-- auth_has_permission checks in a Promise.all, without first needing a separate query just to
-- learn the caller's school_id. Thin wrapper only -- all real logic (is_core guard, fail-safe
-- defaults) lives in school_module_enabled itself, not duplicated here.
create or replace function public.auth_school_module_enabled(p_key text)
returns boolean
language sql
stable
security definer
set search_path to 'public'
as $$
  select public.school_module_enabled(auth_school_id(), p_key);
$$;
revoke all on function public.auth_school_module_enabled(text) from public;
grant execute on function public.auth_school_module_enabled(text) to authenticated;
