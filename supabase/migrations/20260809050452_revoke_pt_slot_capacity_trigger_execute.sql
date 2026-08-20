-- check_pt_slot_capacity is a trigger function only, never meant to be called directly via RPC —
-- same fix already applied to check_consecutive_absences. Advisor flagged it as anon-executable
-- because SECURITY DEFINER functions default to PUBLIC EXECUTE grants.
revoke execute on function check_pt_slot_capacity() from public, anon, authenticated;
