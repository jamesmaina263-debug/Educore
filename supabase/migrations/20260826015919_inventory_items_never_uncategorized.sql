-- Reconstructed from live schema introspection (Supabase project alzqlvfaftwegptfbfej).
-- Original SQL never committed to the repo. Guarantees category_id is never null on
-- inventory_items by defaulting to a per-school "Uncategorized" category (creating it on
-- demand) whenever an insert/update would leave it null. Trigger fires only WHEN
-- (new.category_id IS NULL) — an explicit category on the incoming row is never overwritten.

CREATE OR REPLACE FUNCTION public.default_inventory_item_category()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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
$function$;

DROP TRIGGER IF EXISTS trg_default_inventory_item_category ON public.inventory_items;
CREATE TRIGGER trg_default_inventory_item_category
  BEFORE INSERT OR UPDATE ON public.inventory_items
  FOR EACH ROW WHEN (new.category_id IS NULL)
  EXECUTE FUNCTION default_inventory_item_category();

-- Hard backstop matching the guarantee — category_id is NOT NULL on inventory_items (already
-- applied via the in-repo 20260825120000_guarantee_category_and_seed_default_items.sql).
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'inventory_items'
      AND column_name = 'category_id' AND is_nullable = 'YES'
  ) THEN
    ALTER TABLE public.inventory_items ALTER COLUMN category_id SET NOT NULL;
  END IF;
END $$;
