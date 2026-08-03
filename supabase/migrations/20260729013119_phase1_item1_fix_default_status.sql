-- A brand-new student can't have a guardian link yet (guardian links
-- require the student row to already exist), so defaulting to 'active'
-- would make trg_students_enforce_primary_guardian block every insert.
-- The real flow: create at 'applied', link guardian(s), then promote to
-- 'active' -- matching the applied->approved->enrolled->active lifecycle
-- from §D even for the manual-registration (MVP) path.
alter table students alter column status set default 'applied';
