-- Phase 0 (gap-closure plan): own-school feature flag reader. ADDITIVE ONLY.
--
-- Why: school_has_feature_flag(school_id, key) is executable by service_role only (revoked from
-- authenticated in 20261002200000 to stop one school probing another school's flags). That is
-- correct, but it means a signed-in user's server component cannot ask "is this feature on for MY
-- school?". This function answers exactly that and nothing else: it takes no school id, resolves
-- the caller's own school itself via auth_school_id(), and returns false for everything else
-- (no school, unknown key, no row, typo'd key). It can never reveal another school's flags.
--
-- Nothing existing is altered: school_has_feature_flag, its grants, both flag tables and their
-- policies are untouched. No flag is created or enabled by this migration.

create or replace function public.my_school_has_feature_flag(p_key text)
returns boolean
language sql
stable
security definer
set search_path to 'public'
as $$
  select coalesce(
    public.school_has_feature_flag(public.auth_school_id(), p_key),
    false
  );
$$;

comment on function public.my_school_has_feature_flag(text) is
  'True only if the calling user''s own school has the named platform feature flag enabled. Fails closed (false) for no school, unknown key, missing row. Takes no school id by design so it cannot be used to read another school''s flags.';

revoke all on function public.my_school_has_feature_flag(text) from public;
revoke execute on function public.my_school_has_feature_flag(text) from anon;
grant execute on function public.my_school_has_feature_flag(text) to authenticated;
