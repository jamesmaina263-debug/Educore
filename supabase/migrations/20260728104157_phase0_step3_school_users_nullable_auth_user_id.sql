-- Parents/students are pre-provisioned by phone (Admissions, Phase 1)
-- before they ever authenticate. Their real auth.users identity is
-- created lazily on first successful OTP verify, not at provisioning
-- time. The existing UNIQUE constraint is unaffected -- Postgres allows
-- multiple NULLs in a UNIQUE column, so this doesn't weaken anything
-- Step 2 already proved.
alter table school_users alter column auth_user_id drop not null;
