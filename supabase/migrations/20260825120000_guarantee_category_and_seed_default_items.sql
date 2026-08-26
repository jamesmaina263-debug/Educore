-- Two related gaps Lucy flagged after the auto-PO-on-approval work:
--
-- 1. inventory_items.category_id has always been nullable, and the "Add Item"
--    form even labelled Category "(optional)" -- nothing stopped an item from
--    ending up with no category at all, which then can't be requisitioned
--    once requisitions become catalog-only (see part 2). Fix: a trigger that
--    auto-assigns an "Uncategorized" category (creating it per-school if
--    missing) whenever category_id would be null, on INSERT *and* UPDATE --
--    UPDATE matters too because `authenticated` already has a direct table
--    UPDATE grant on inventory_items (20260803015826), not just through
--    create_inventory_item, so a null category could otherwise be set via any
--    client-side update, not only at creation. Backfill any existing null
--    rows, then add NOT NULL as a hard backstop once nothing can violate it.
--
-- 2. Every category should have a starter set of common items already sitting
--    in the catalog at quantity 0, so a requisition (now catalog-only, see
--    the application-layer change alongside this migration) has something to
--    pick from immediately rather than requiring the officer to hand-add
--    every item before they can ever requisition it. Quantity stays 0 until
--    goods are actually received (record_goods_received already increments
--    it) -- these are catalog placeholders, not opening stock. "Add item"
--    remains exactly as-is for anything not on the starter list.
--    Textbooks & Instructional Materials gets generic placeholders only
--    (titles are subject/grade-specific -- Lucy confirmed this is fine over
--    specific titles). Uncategorized gets no starter items -- it's a
--    catch-all safety net, not something to browse and requisition from.
--
-- Seeding reuses the existing case/whitespace-insensitive unique index
-- (20260825103519, inventory_items_school_name_ci_idx) as the ON CONFLICT
-- target, so a school that already has e.g. "Paracetamol" from its own manual
-- entry is left untouched -- no duplicates, no overwrites, matching the exact
-- pattern the category seeding migration (20260824150000) already uses.

-- Part 1: guarantee every item has a category ---------------------------

create or replace function public.default_inventory_item_category()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_uncat_id uuid;
begin
  if new.category_id is not null then
    return new;
  end if;

  select id into v_uncat_id
  from public.inventory_categories
  where school_id = new.school_id and name = 'Uncategorized';

  if v_uncat_id is null then
    insert into public.inventory_categories (school_id, name)
    values (new.school_id, 'Uncategorized')
    on conflict (school_id, name) do nothing
    returning id into v_uncat_id;

    if v_uncat_id is null then
      select id into v_uncat_id
      from public.inventory_categories
      where school_id = new.school_id and name = 'Uncategorized';
    end if;
  end if;

  new.category_id := v_uncat_id;
  return new;
end;
$$;

comment on function public.default_inventory_item_category is
  'Guarantees inventory_items.category_id is never null: auto-assigns (creating if needed) a per-school "Uncategorized" category on any insert or update that would otherwise leave it null.';

drop trigger if exists trg_default_inventory_item_category on public.inventory_items;
create trigger trg_default_inventory_item_category
  before insert or update on public.inventory_items
  for each row execute function public.default_inventory_item_category();

-- Backfill: give every school an Uncategorized category, then move any
-- existing null-category items into it.
insert into public.inventory_categories (school_id, name)
select id, 'Uncategorized' from public.schools
on conflict (school_id, name) do nothing;

update public.inventory_items ii
set category_id = ic.id
from public.inventory_categories ic
where ii.category_id is null
  and ic.school_id = ii.school_id
  and ic.name = 'Uncategorized';

alter table public.inventory_items alter column category_id set not null;

-- Part 2: seed starter items (quantity 0) per category -------------------

create or replace function public.seed_default_inventory_items(p_school_id uuid)
returns void
language plpgsql
security definer
set search_path to 'public'
as $$
begin
  insert into public.inventory_items (school_id, category_id, name, unit)
  select p_school_id, ic.id, v.name, v.unit
  from (
    values
      ('Stationery & Office Supplies', 'Pens', 'pieces'),
      ('Stationery & Office Supplies', 'Pencils', 'pieces'),
      ('Stationery & Office Supplies', 'Exercise books', 'pieces'),
      ('Stationery & Office Supplies', 'Manila paper', 'pieces'),
      ('Stationery & Office Supplies', 'Printer paper', 'reams'),
      ('Stationery & Office Supplies', 'Staplers', 'pieces'),
      ('Stationery & Office Supplies', 'Marker pens', 'pieces'),
      ('Stationery & Office Supplies', 'Chalk', 'boxes'),
      ('Stationery & Office Supplies', 'Dusters', 'pieces'),

      ('Textbooks & Instructional Materials', 'Textbook (unspecified title)', 'pieces'),
      ('Textbooks & Instructional Materials', 'Revision workbook (unspecified title)', 'pieces'),
      ('Textbooks & Instructional Materials', 'Teacher''s guide (unspecified title)', 'pieces'),
      ('Textbooks & Instructional Materials', 'Wall chart / instructional poster', 'pieces'),

      ('Laboratory Equipment & Chemicals', 'Beakers', 'pieces'),
      ('Laboratory Equipment & Chemicals', 'Test tubes', 'pieces'),
      ('Laboratory Equipment & Chemicals', 'Bunsen burners', 'pieces'),
      ('Laboratory Equipment & Chemicals', 'Litmus paper', 'packets'),
      ('Laboratory Equipment & Chemicals', 'Safety goggles', 'pieces'),

      ('Sports & Games Equipment', 'Footballs', 'pieces'),
      ('Sports & Games Equipment', 'Netballs', 'pieces'),
      ('Sports & Games Equipment', 'Whistles', 'pieces'),
      ('Sports & Games Equipment', 'Cones', 'pieces'),
      ('Sports & Games Equipment', 'Skipping ropes', 'pieces'),

      ('Furniture & Fittings', 'Student desks', 'pieces'),
      ('Furniture & Fittings', 'Chairs', 'pieces'),
      ('Furniture & Fittings', 'Cupboards', 'pieces'),
      ('Furniture & Fittings', 'Whiteboards', 'pieces'),

      ('Cleaning & Sanitation Supplies', 'Detergent', 'kg'),
      ('Cleaning & Sanitation Supplies', 'Brooms', 'pieces'),
      ('Cleaning & Sanitation Supplies', 'Mops', 'pieces'),
      ('Cleaning & Sanitation Supplies', 'Disinfectant', 'litres'),
      ('Cleaning & Sanitation Supplies', 'Toilet paper', 'rolls'),
      ('Cleaning & Sanitation Supplies', 'Hand soap', 'pieces'),

      ('Kitchen & Catering Supplies', 'Sufurias (cooking pots)', 'pieces'),
      ('Kitchen & Catering Supplies', 'Serving spoons', 'pieces'),
      ('Kitchen & Catering Supplies', 'Plates', 'pieces'),
      ('Kitchen & Catering Supplies', 'Cups', 'pieces'),
      ('Kitchen & Catering Supplies', 'Maize flour', 'kg'),
      ('Kitchen & Catering Supplies', 'Cooking oil', 'litres'),

      ('ICT & Electronics', 'Laptops', 'pieces'),
      ('ICT & Electronics', 'Printers', 'pieces'),
      ('ICT & Electronics', 'Projectors', 'pieces'),
      ('ICT & Electronics', 'Extension cables', 'pieces'),
      ('ICT & Electronics', 'Printer cartridges', 'pieces'),

      ('Boarding & Dormitory Supplies', 'Mattresses', 'pieces'),
      ('Boarding & Dormitory Supplies', 'Blankets', 'pieces'),
      ('Boarding & Dormitory Supplies', 'Bed sheets', 'pieces'),
      ('Boarding & Dormitory Supplies', 'Pillows', 'pieces'),
      ('Boarding & Dormitory Supplies', 'Lockers', 'pieces'),

      ('Building & Maintenance Materials', 'Paint', 'litres'),
      ('Building & Maintenance Materials', 'Cement', 'bags'),
      ('Building & Maintenance Materials', 'Nails', 'kg'),
      ('Building & Maintenance Materials', 'Padlocks', 'pieces'),
      ('Building & Maintenance Materials', 'Light bulbs', 'pieces'),

      ('Medical Supplies', 'Paracetamol tablets', 'packets'),
      ('Medical Supplies', 'Bandages', 'rolls'),
      ('Medical Supplies', 'Antiseptic', 'bottles'),
      ('Medical Supplies', 'Disposable gloves', 'boxes'),
      ('Medical Supplies', 'Thermometers', 'pieces'),
      ('Medical Supplies', 'Cotton wool', 'packets'),
      ('Medical Supplies', 'ORS sachets', 'pieces'),
      ('Medical Supplies', 'Gauze', 'rolls')
  ) as v(category_name, name, unit)
  join public.inventory_categories ic on ic.school_id = p_school_id and ic.name = v.category_name
  on conflict (school_id, lower(trim(name))) do nothing;
end;
$$;

comment on function public.seed_default_inventory_items is
  'Seeds a starter set of common items (quantity 0 -- catalog placeholders, not opening stock) into each of a school''s default categories. Idempotent via the case/whitespace-insensitive item-name unique index. Called on school creation and once as a backfill for existing schools.';

revoke all on function public.seed_default_inventory_items(uuid) from public, anon, authenticated;

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
    (new.id, 'Medical Supplies'),
    (new.id, 'Uncategorized')
  on conflict (school_id, name) do nothing;

  perform public.seed_default_inventory_items(new.id);

  return new;
end;
$$;

comment on function public.seed_default_inventory_categories is
  'AFTER INSERT trigger on schools: seeds a starter set of stock categories relevant to a Kenyan school (plus Uncategorized, the fallback for default_inventory_item_category), then seeds each category with a starter set of common items at quantity 0. Purely additive -- schools remain free to add, rename, or ignore categories, and to add further items, exactly as before.';

-- Backfill existing schools: any starter category they're missing, then the
-- starter items for every default category they now have (including ones
-- they already had before this migration).
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
    ('Medical Supplies'),
    ('Uncategorized')
) as v(name)
where not exists (
  select 1 from public.inventory_categories ic where ic.school_id = s.id and ic.name = v.name
)
on conflict (school_id, name) do nothing;

do $$
declare
  v_school record;
begin
  for v_school in select id from public.schools loop
    perform public.seed_default_inventory_items(v_school.id);
  end loop;
end;
$$;
