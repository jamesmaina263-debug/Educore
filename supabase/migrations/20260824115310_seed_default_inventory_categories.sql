-- Gap: inventory_categories has never been seeded with any general-purpose defaults --
-- the only category ever auto-created is 'Medical Supplies', and even that only for
-- schools that existed at the time of the health module migration (20260809132222),
-- via a one-off backfill with no trigger. Every other school (all of them, for general
-- stock) lands on an empty Category dropdown in Inventory > Stock and has to type every
-- category by hand via "Add category" before they can even file their first item.
--
-- Fix, matching the same seed-on-create + backfill pattern already used for leave types
-- (20260820013707) and application document requirements (20260822090000):
--   1. An AFTER INSERT trigger on schools seeds a starter set of categories that map to
--      what a typical Kenyan school (day or boarding, primary/secondary, CBC-aligned)
--      actually stocks -- stationery, textbooks/instructional materials, lab equipment,
--      games/sports gear, furniture, cleaning/sanitation, kitchen/catering, ICT,
--      boarding/dormitory supplies, and building/maintenance materials. 'Medical
--      Supplies' is included too, using the exact same name the Health module's
--      inventory tab already looks up by name (src/app/(app)/health/_data.ts) -- so
--      every new school's Health > Inventory works out of the box as well, closing
--      that latent gap at the same time.
--   2. A backfill for existing schools, ON CONFLICT (school_id, name) DO NOTHING so a
--      school that already has a category with the same name (e.g. 'Medical Supplies'
--      from the earlier backfill) is left untouched -- no duplicates, no overwrites.
--
-- This only ever inserts starter rows. It does not touch, restrict, or remove the
-- existing "Add category" flow (createCategoryAction / inventory-section.tsx) --
-- schools can still add, and can still rename their own categories, exactly as before.
-- No table, policy, or application code is changed.

create or replace function public.seed_default_inventory_categories()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $$
begin
  insert into public.inventory_categories (school_id, name)
  values
    (new.id, 'Stationery & Office Supplies'),
    (new.id, 'Textbooks & Instructional Materials'),
    (new.id, 'Laboratory Equipment & Chemicals'),
    (new.id, 'Sports & Games Equipment'),
    (new.id, 'Furniture & Fittings'),
    (new.id, 'Cleaning & Sanitation Supplies'),
    (new.id, 'Kitchen & Catering Supplies'),
    (new.id, 'ICT & Electronics'),
    (new.id, 'Boarding & Dormitory Supplies'),
    (new.id, 'Building & Maintenance Materials'),
    (new.id, 'Medical Supplies')
  on conflict (school_id, name) do nothing;

  return new;
end;
$$;

comment on function public.seed_default_inventory_categories is
  'AFTER INSERT trigger on schools: seeds a starter set of stock categories relevant to a Kenyan school so Inventory > Stock is usable immediately, and so Health > Inventory (which looks up "Medical Supplies" by name) works out of the box. Purely additive -- schools remain free to add, rename, or ignore these via the existing "Add category" option.';

drop trigger if exists trg_seed_default_inventory_categories on public.schools;
create trigger trg_seed_default_inventory_categories
  after insert on public.schools
  for each row execute function public.seed_default_inventory_categories();

-- Backfill every existing school that's missing any of these starter categories --
-- covers schools created before this migration, including ones created after
-- 20260809132222 that never got even 'Medical Supplies'.
insert into public.inventory_categories (school_id, name)
select s.id, v.name
from public.schools s
cross join (
  values
    ('Stationery & Office Supplies'),
    ('Textbooks & Instructional Materials'),
    ('Laboratory Equipment & Chemicals'),
    ('Sports & Games Equipment'),
    ('Furniture & Fittings'),
    ('Cleaning & Sanitation Supplies'),
    ('Kitchen & Catering Supplies'),
    ('ICT & Electronics'),
    ('Boarding & Dormitory Supplies'),
    ('Building & Maintenance Materials'),
    ('Medical Supplies')
) as v(name)
where not exists (
  select 1 from public.inventory_categories ic where ic.school_id = s.id and ic.name = v.name
)
on conflict (school_id, name) do nothing;
