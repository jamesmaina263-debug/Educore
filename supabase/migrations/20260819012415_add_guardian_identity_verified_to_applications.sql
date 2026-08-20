-- Supports optional (non-blocking) OTP verification when a public application submission's
-- guardian phone matches an existing guardian account at the school. Default true: this only
-- has meaning for the online public apply flow's existing-guardian-match case; every other
-- insert path (walk-in applications created by staff, brand-new guardians with no match, etc.)
-- has no impersonation risk to flag, so they're unaffected by this column.
alter table public.applications
  add column if not exists guardian_identity_verified boolean not null default true;

comment on column public.applications.guardian_identity_verified is
  'False only when a public application was linked to an existing guardian account by phone match without a successful OTP confirmation. Never blocks submission — for staff review visibility only.';
