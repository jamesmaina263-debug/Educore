-- 1. "Uncategorized" joins the starter categories seeded for every new school.
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

  return new;
end;
$$;

-- 2. Backfill "Uncategorized" for every existing school missing it.
insert into public.inventory_categories (school_id, name)
select s.id, 'Uncategorized'
from public.schools s
where not exists (
  select 1 from public.inventory_categories ic where ic.school_id = s.id and ic.name = 'Uncategorized'
)
on conflict (school_id, name) do nothing;

-- 3. Backfill any existing item that has no category onto its school's Uncategorized category.
update public.inventory_items ii
set category_id = ic.id
from public.inventory_categories ic
where ii.category_id is null
  and ic.school_id = ii.school_id
  and ic.name = 'Uncategorized';

-- 4. Guarantee: any insert or update that would leave category_id null is redirected to
-- that school's Uncategorized category instead.
create or replace function public.default_inventory_item_category()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_uncategorized_id uuid;
begin
  select id into v_uncategorized_id
  from public.inventory_categories
  where school_id = new.school_id and name = 'Uncategorized';

  if v_uncategorized_id is null then
    insert into public.inventory_categories (school_id, name)
    values (new.school_id, 'Uncategorized')
    on conflict (school_id, name) do update set name = excluded.name
    returning id into v_uncategorized_id;
  end if;

  new.category_id := v_uncategorized_id;
  return new;
end;
$$;

comment on function public.default_inventory_item_category is
  'BEFORE INSERT/UPDATE trigger on inventory_items: whenever category_id would be left null, files the item under that school''s "Uncategorized" category instead (creating the category first if it somehow does not exist yet). Ensures category_id can never be null regardless of insert path.';

drop trigger if exists trg_default_inventory_item_category on public.inventory_items;
create trigger trg_default_inventory_item_category
  before insert or update on public.inventory_items
  for each row
  when (new.category_id is null)
  execute function public.default_inventory_item_category();

-- 5. Hard guarantee at the column level.
alter table public.inventory_items alter column category_id set not null;
