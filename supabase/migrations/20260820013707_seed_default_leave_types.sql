-- Rectify: leave_types is school-configurable by design (its own table, school_id-scoped,
-- RLS gated on staff.manage) but no UI or seeding step ever populated it for any school.
-- Result: every school's staff Leave tab shows "Request leave" permanently disabled
-- (leaveTypes.length === 0), even though the request/approve/cancel flow itself works fine.
--
-- Fix, in two parts:
--   1. A dedicated settings screen (Settings > Leave Types, see the accompanying app
--      changes) so schools can add/rename/retire their own leave types going forward.
--   2. This migration seeds sensible Kenyan-employment-law-aligned defaults (Annual,
--      Sick, Maternity, Paternity, Compassionate, Study) so no school -- including ones
--      onboarded after today -- ever lands on an empty, unusable Leave tab out of the box.
--      Schools remain free to edit/delete/add to these via the new settings screen.
--
-- Design: an AFTER INSERT trigger on schools, not application-code seeding in the signup
-- action, so this is correct regardless of which entry point creates a school (currently
-- only src/app/signup/actions.ts, but this stays correct even if a future entry point --
-- e.g. a super-admin "create school" panel -- is added later without remembering to call
-- anything special). ON CONFLICT DO NOTHING against the existing unique(school_id, name)
-- constraint keeps this idempotent.

create or replace function public.seed_default_leave_types()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $$
begin
  insert into public.leave_types (school_id, name, days_per_year)
  values
    (new.id, 'Annual Leave', 21),
    (new.id, 'Sick Leave', 14),
    (new.id, 'Maternity Leave', 90),
    (new.id, 'Paternity Leave', 14),
    (new.id, 'Compassionate Leave', 5),
    (new.id, 'Study Leave', 10)
  on conflict (school_id, name) do nothing;

  return new;
end;
$$;

comment on function public.seed_default_leave_types is
  'AFTER INSERT trigger on schools: seeds a default set of Kenyan-employment-law-aligned leave types for every new school so its staff Leave tab is usable immediately. Schools can edit/delete/add their own afterward via Settings > Leave Types -- these are just a starting point, never re-applied or enforced later.';

drop trigger if exists trg_seed_default_leave_types on public.schools;
create trigger trg_seed_default_leave_types
  after insert on public.schools
  for each row execute function public.seed_default_leave_types();

-- Backfill: apply the same defaults to every school that already exists and currently has
-- zero leave types (i.e. every school created before this migration -- confirmed nobody has
-- used the never-built management UI to add their own, since it never existed). A school
-- that somehow already has leave types of its own is left untouched.
insert into public.leave_types (school_id, name, days_per_year)
select s.id, v.name, v.days_per_year
from public.schools s
cross join (
  values
    ('Annual Leave', 21),
    ('Sick Leave', 14),
    ('Maternity Leave', 90),
    ('Paternity Leave', 14),
    ('Compassionate Leave', 5),
    ('Study Leave', 10)
) as v(name, days_per_year)
where not exists (
  select 1 from public.leave_types lt where lt.school_id = s.id
)
on conflict (school_id, name) do nothing;
