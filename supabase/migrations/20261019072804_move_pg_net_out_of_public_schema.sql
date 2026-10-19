-- pg_net is not relocatable, so drop and recreate it in the extensions schema.
-- Same transaction: either the whole swap happens or nothing changes.
drop extension if exists pg_net;
create extension pg_net with schema extensions;
