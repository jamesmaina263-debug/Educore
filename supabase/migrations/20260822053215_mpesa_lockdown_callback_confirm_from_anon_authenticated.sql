-- Fix: "revoke all from public" doesn't strip default per-role EXECUTE grants Supabase
-- applies at function-creation time. authenticated (and anon) could still call
-- mpesa_stk_callback_confirm directly. Explicit revoke by role name required.
revoke execute on function public.mpesa_stk_callback_confirm(text, integer, text, text, numeric, text) from anon, authenticated;
