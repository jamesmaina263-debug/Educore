-- Bug: application_document_requirements was only ever seeded for schools that existed at
-- the time of the Phase 10 migration (20260810064645). Any school created after that
-- migration ran (e.g. via /signup) gets zero rows, which means the "Documents" section
-- silently doesn't render at all -- neither on the public /apply form nor in the
-- Admissions wizard's Documents step -- because both derive their fields entirely from
-- this table. Confirmed live: "Gititu High Schoool" (created 2026-08-17, after the
-- migration) has 0 rows here.
--
-- Fix: seed the same default checklist automatically whenever a school is created, via an
-- AFTER INSERT trigger on schools -- not application code, so this can't be forgotten by a
-- future entry point (signup form, admin-created school, etc.), matching the same
-- race-safe/trigger-owned pattern already used for admission numbers.

create or replace function public.seed_default_document_requirements()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $$
begin
  insert into public.application_document_requirements (school_id, category, label, required, display_order)
  values
    (new.id, 'birth_certificate', 'Birth Certificate', true, 1),
    (new.id, 'previous_report', 'Previous School Report', true, 2),
    (new.id, 'guardian_id', 'Guardian ID', true, 3),
    (new.id, 'transfer_letter', 'Transfer Letter', true, 4),
    (new.id, 'passport_photo', 'Passport Photo', true, 5)
  on conflict (school_id, category) do nothing;
  return new;
end;
$$;

comment on function public.seed_default_document_requirements is
  'AFTER INSERT trigger on schools: seeds the default application document checklist (same defaults as the original Phase 10 backfill) so every school -- not just ones that existed at migration time -- has a working Documents step on /apply and in the Admissions wizard. Schools can edit/add categories afterward.';

drop trigger if exists trg_seed_default_document_requirements on public.schools;
create trigger trg_seed_default_document_requirements
  after insert on public.schools
  for each row execute function public.seed_default_document_requirements();

-- Backfill schools that were created after the Phase 10 migration and so never got seeded
-- (currently just Gititu High Schoool, but written generically for any other gap).
insert into public.application_document_requirements (school_id, category, label, required, display_order)
select s.id, v.category, v.label, true, v.ord
from public.schools s
cross join (values
  ('birth_certificate', 'Birth Certificate', 1),
  ('previous_report', 'Previous School Report', 2),
  ('guardian_id', 'Guardian ID', 3),
  ('transfer_letter', 'Transfer Letter', 4),
  ('passport_photo', 'Passport Photo', 5)
) as v(category, label, ord)
where not exists (
  select 1 from public.application_document_requirements r where r.school_id = s.id and r.category = v.category
);
