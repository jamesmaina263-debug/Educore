-- Fresh production-readiness sweep (Sep 15 2026): mpesa_credentials, otp_codes, and
-- rate_limit_events are RLS-enabled with zero policies, which correctly default-denies
-- anon/authenticated access today. But all three still carried full table-level GRANTs
-- (SELECT/INSERT/UPDATE/DELETE/TRUNCATE/REFERENCES/TRIGGER) to anon and authenticated from
-- their original CREATE TABLE statements -- meaning the only thing standing between a
-- PostgREST client and M-Pesa consumer secrets / OTP hashes / the rate-limit counter table
-- is "no policy exists yet". Any future migration that adds even one permissive policy to
-- these tables (e.g. by copy-pasting a pattern from another table) would instantly expose
-- them, with no error or warning. Revoking the redundant grants makes the deny explicit and
-- defense-in-depth: service_role (which bypasses RLS entirely) is untouched, so
-- generate_otp(), set_mpesa_credentials(), increment_and_check_rate_limit() and friends
-- (all SECURITY DEFINER, called via RPC) continue working exactly as before.
--
-- Applied live to prod during the audit session (version 20260915064922) -- this file
-- reconciles the repo to match, same as prior migration-drift fixes.
revoke all on public.mpesa_credentials from anon, authenticated;
revoke all on public.otp_codes from anon, authenticated;
revoke all on public.rate_limit_events from anon, authenticated;
