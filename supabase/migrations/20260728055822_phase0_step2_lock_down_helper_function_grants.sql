-- These functions only ever return facts about the caller's own session
-- (they're not a data leak even for anon), but anon has no legitimate
-- reason to call them directly, per the "no unnecessary anon EXECUTE
-- grants" lesson learned on the POS project.
revoke execute on function auth_school_id() from public;
revoke execute on function auth_is_super_admin() from public;
revoke execute on function auth_has_permission(text) from public;

grant execute on function auth_school_id() to authenticated;
grant execute on function auth_is_super_admin() to authenticated;
grant execute on function auth_has_permission(text) to authenticated;
