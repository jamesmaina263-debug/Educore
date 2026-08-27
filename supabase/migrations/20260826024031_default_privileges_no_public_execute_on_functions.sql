
-- Stop Postgres from auto-granting EXECUTE to PUBLIC on newly created functions.
-- This only affects functions created AFTER this point (by whichever role runs
-- this migration, typically postgres/supabase_admin) -- it does not retroactively
-- change privileges on existing functions.
alter default privileges in schema public revoke execute on functions from public;

-- Since new functions will no longer default to PUBLIC-executable, make sure
-- authenticated (the normal logged-in app role) still gets EXECUTE by default,
-- so future functions don't silently become uncallable until someone remembers
-- to grant explicitly.
alter default privileges in schema public grant execute on functions to authenticated;
