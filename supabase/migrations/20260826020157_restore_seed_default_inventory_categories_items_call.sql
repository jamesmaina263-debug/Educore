-- Corrective: my own 20260826015919_inventory_items_never_uncategorized migration
-- ran after (and was unaware of) a parallel session's 20260825180558 migration, which
-- had already solved the exact same "never uncategorized" problem AND additionally
-- extended seed_default_inventory_categories() to call seed_default_inventory_items(new.id)
-- so new schools get starter catalog items, not just starter categories. My CREATE OR
-- REPLACE of the same function silently dropped that call. Restoring it verbatim.
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
