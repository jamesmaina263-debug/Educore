-- Reconstructed from live schema introspection (Supabase project alzqlvfaftwegptfbfej).
-- Original SQL never committed to the repo. Current live seed_default_inventory_categories()
-- calls seed_default_inventory_items(new.id) at the end — the "restore" in this migration's
-- name suggests that call was dropped in an earlier edit and is being put back here.

CREATE OR REPLACE FUNCTION public.seed_default_inventory_categories()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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
$function$;
