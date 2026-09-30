-- Fix: ensure_qa_test_account() is SECURITY DEFINER (needs elevated rights to
-- write auth.users/auth.identities) but Postgres/PostgREST grants EXECUTE on
-- new public-schema functions to anon/authenticated by default. Unrevoked,
-- that let any client call this RPC with an arbitrary school_id and create a
-- school_owner-level account with a fixed password -- a privilege-escalation
-- hole across every school. Lock it down to service_role/postgres only; it is
-- meant to be run from migrations/admin tooling, never from the client API.

revoke execute on function public.ensure_qa_test_account(uuid, text) from public;
revoke execute on function public.ensure_qa_test_account(uuid, text) from anon;
revoke execute on function public.ensure_qa_test_account(uuid, text) from authenticated;
grant execute on function public.ensure_qa_test_account(uuid, text) to service_role;
