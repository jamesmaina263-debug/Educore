-- access_token: lets an applicant check status / upload requested documents
-- without an account (Brief 4.15 "Application-stage parent portal — status,
-- document upload"). A random unguessable token in the URL, not the
-- application_number (which is sequential and would let one family browse
-- another's application by incrementing it).
alter table public.applications add column if not exists access_token uuid not null default gen_random_uuid();
create unique index if not exists idx_applications_access_token on public.applications(access_token);

-- Freeform note from the applicant (e.g. "applying for Grade 4, transferring
-- from X") — the old students-based apply flow had this as application_notes;
-- applications has structured fields for most of it but nothing freeform yet.
alter table public.applications add column if not exists notes text;
