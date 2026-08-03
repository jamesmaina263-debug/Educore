
-- Previous revoke only targeted the `anon` grant, but Postgres functions default-grant EXECUTE to
-- PUBLIC, which anon inherits from regardless. Revoke from PUBLIC directly, then grant back only to
-- authenticated (the function itself still checks auth_has_permission('exams.write') at runtime,
-- so this narrows the surface rather than being the only guard).
revoke execute on function close_exam(uuid) from public;
revoke execute on function reopen_exam(uuid) from public;
grant execute on function close_exam(uuid) to authenticated;
grant execute on function reopen_exam(uuid) to authenticated;
