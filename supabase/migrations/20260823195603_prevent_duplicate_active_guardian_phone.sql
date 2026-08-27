-- Bug found 2026-08-23: two active school_users rows (different names, same
-- school) shared the exact same phone number, which crashed verify-otp's
-- .maybeSingle() lookup with "multiple rows returned" -- permanently
-- locking that phone out of OTP login with no clear error message.
--
-- This partial unique index stops a second active row from ever being
-- created against a phone already claimed by an active account. Inactive
-- rows are exempt (deactivated/duplicate accounts can keep their historical
-- phone without blocking a reassignment), matching how the rest of the app
-- already treats status='active' as the operative scope for a guardian.
create unique index uq_school_users_active_phone
  on school_users (phone)
  where status = 'active' and phone is not null;
