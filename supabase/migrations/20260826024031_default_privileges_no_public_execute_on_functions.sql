-- Reconstructed from live schema introspection (Supabase project alzqlvfaftwegptfbfej).
-- Original SQL never committed to the repo. Confirmed live via pg_default_acl: the default
-- ACL for functions created by `postgres` (and `supabase_admin`) in the `public` schema
-- already excludes PUBLIC from the default EXECUTE grant (Postgres normally grants EXECUTE
-- to PUBLIC on every new function unless a default-privileges rule says otherwise) — so any
-- future function created without an explicit GRANT starts locked down rather than open.

ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public
  REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC;
