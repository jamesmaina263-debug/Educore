-- Auto-reconciled by scripts/reconcile_migration_drift.py: this version was applied directly to production without a matching git commit at the time. Content below is byte-for-byte what's recorded in supabase_migrations.schema_migrations for version 20260913123452 -- reconstructed, not rewritten.

-- Root cause behind H6: this project's default privileges for the `public` schema grant
-- EXECUTE directly to the `anon` role by name on every new function created by `postgres`
-- (confirmed live via pg_default_acl: {postgres=X/postgres,anon=X/postgres,
-- authenticated=X/postgres,service_role=X/postgres}). Migrations run as `postgres`
-- (current_user for apply_migration), so this is the default ACL that actually governs
-- every future migration-created function.
--
-- 20260826024031 ("default_privileges_no_public_execute_on_functions") addressed the wrong
-- grantee: it revoked the PUBLIC pseudo-role's default EXECUTE, but the ACL above never had
-- a bare PUBLIC entry to begin with -- anon's grant is separate and direct, and that
-- migration never touched it. That's exactly why school_has_feature_flag (created 20260909,
-- after that "fix") still needed an explicit per-function anon revoke in the H6 migration.
--
-- A second default ACL exists for role supabase_admin with the same anon grant, but ALTER
-- DEFAULT PRIVILEGES FOR ROLE supabase_admin errors here with "permission denied to change
-- default privileges" -- postgres (this project's migration role) isn't supabase_admin and
-- can't act as it. That role's defaults appear to govern objects Supabase's own platform
-- tooling creates, not this repo's migrations, so it's out of reach and out of scope here.
--
-- Closes the gap for every future `create function` in public made through this repo's
-- migrations. Does not touch authenticated/service_role, and does not retroactively change
-- any existing function's ACL -- ALTER DEFAULT PRIVILEGES only affects objects created after
-- it runs.
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public
  REVOKE EXECUTE ON FUNCTIONS FROM anon;
