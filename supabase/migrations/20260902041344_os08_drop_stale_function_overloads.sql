-- CREATE OR REPLACE with an added trailing parameter created a NEW overload
-- instead of replacing the original -- same trap as the earlier OTP-email-channel
-- incident. This left both the old and new signatures live, and because the new
-- one's added param has a default, a 4-arg call became genuinely ambiguous
-- between the two -- breaking every existing caller of these functions in
-- production (record_stock_movement, issue_health_stock, issue_library_loan,
-- issue_library_loan_to_staff) the moment the previous migration applied.
-- Dropping the old-signature overloads now; the new ones behave identically
-- for callers that omit p_client_mutation_id (it defaults to null).

drop function if exists public.record_stock_movement(uuid, text, integer, text);
drop function if exists public.issue_health_stock(uuid, integer, text);
drop function if exists public.issue_library_loan(uuid, uuid, date);
drop function if exists public.issue_library_loan_to_staff(uuid, uuid, date);
