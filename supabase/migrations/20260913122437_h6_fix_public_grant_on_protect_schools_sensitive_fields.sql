-- protect_schools_sensitive_fields still showed anon_can_execute = true after the H6 revoke
-- above because its ACL carried a bare PUBLIC grant ("=X/postgres") from its original
-- creation, predating this project's later ALTER DEFAULT PRIVILEGES setup -- unlike
-- school_has_feature_flag, its migration never ran a `revoke ... from public`. `revoke
-- execute ... from anon` doesn't touch a separate PUBLIC grant, and anon always inherits
-- PUBLIC's privileges, so the bare entry alone was enough to keep anon able to call it.
-- Revoking from public closes that. (Not independently exploitable either way -- Postgres
-- rejects direct invocation of trigger functions outside trigger context -- but this makes
-- the grant match the other six and match what "revoke anon EXECUTE" actually intended.)
revoke execute on function public.protect_schools_sensitive_fields() from public;
