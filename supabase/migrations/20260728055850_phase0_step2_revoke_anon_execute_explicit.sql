-- Supabase's default privileges grant EXECUTE to anon directly on new
-- functions in public, separately from the PUBLIC pseudo-role. Revoking
-- from public alone didn't touch this direct grant, so doing it explicitly.
revoke execute on function auth_school_id() from anon;
revoke execute on function auth_is_super_admin() from anon;
revoke execute on function auth_has_permission(text) from anon;
