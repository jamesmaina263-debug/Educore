-- Caught before shipping: the public application form collects the guardian's
-- relationship to the applicant, but applications had nowhere to store it
-- (student_guardians doesn't exist yet at this stage — that link is only
-- created at actual enrollment in Phase 11/12).
alter table public.applications add column if not exists guardian_relationship text;
alter table public.applications add constraint applications_guardian_relationship_check
  check (guardian_relationship is null or guardian_relationship in ('mother', 'father', 'guardian', 'other'));
