-- Phase 11: Admissions wizard shell — walk-in entry point + step navigation
-- shell only (Brief 4.16.1, 4.16.8, 4.16.9, 4.16.11). Step *content* wiring
-- to each target module (Academics/Boarding/Transport/Health/Finance) is
-- explicitly Phase 12, not this one.
--
-- Both entry points (online application via Phase 10, and walk-in here) must
-- converge on the same `applications` row and the same wizard — never two
-- separate admission systems (Brief 4.16.1). A walk-in is simply a new
-- `applications` row created directly in 'draft' status instead of arriving
-- via the public /apply form.

-- Latent bug: 'draft' has been a valid `applications.status` value since the
-- Phase 10 migration, but first_name/last_name/date_of_birth/gender were all
-- declared `not null` from the start — so a draft could never actually be
-- created empty, which is the entire point of a walk-in draft (the officer
-- hasn't typed the student's details yet at the moment they click "+ New
-- Walk-In Admission"). Relaxing these for 'draft' rows only; anything past
-- draft still requires them, enforced by a check constraint rather than by
-- convention.
alter table public.applications alter column first_name drop not null;
alter table public.applications alter column last_name drop not null;
alter table public.applications alter column date_of_birth drop not null;
alter table public.applications alter column gender drop not null;

alter table public.applications add constraint applications_draft_or_complete_biodata_check
  check (
    status = 'draft'
    or (first_name is not null and last_name is not null and date_of_birth is not null and gender is not null)
  );

-- Wizard progress, for the shell's own navigation/resume/draft-list needs.
-- Deliberately just an integer step pointer, not a jsonb staging blob for
-- step content — Phase 12 owns deciding how each step's real data is held
-- before Complete Enrollment commits it, and can extend this table then.
alter table public.applications
  add column if not exists wizard_current_step int not null default 0;

create index if not exists idx_applications_draft_status
  on public.applications(school_id, status) where status = 'draft';
