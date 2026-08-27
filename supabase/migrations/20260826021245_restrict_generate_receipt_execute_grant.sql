-- Reconstructed from live schema introspection (Supabase project alzqlvfaftwegptfbfej).
-- Original SQL never committed to the repo. Confirmed live: generate_receipt(uuid) has no
-- EXECUTE grant to anon, authenticated, or PUBLIC — it's only ever invoked internally (via
-- `perform public.generate_receipt(...)`) from other SECURITY DEFINER functions such as
-- reconcile_pending_mpesa_payments() and mpesa_stk_callback_confirm(), never called directly
-- as a client-facing RPC.

REVOKE EXECUTE ON FUNCTION public.generate_receipt(uuid) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.generate_receipt(uuid) FROM anon;
REVOKE EXECUTE ON FUNCTION public.generate_receipt(uuid) FROM authenticated;
