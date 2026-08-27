-- "Add item" had no way to set an opening quantity -- items always started at 0,
-- and setting a real starting count required a separate "Record stock movement"
-- step that was easy to miss. This lets Add Item set an opening quantity directly,
-- while still recording it as a proper audited "in" movement (not a silent number
-- change), matching how every other stock change in this app is tracked.
create or replace function public.create_inventory_item(
  p_name text,
  p_unit text,
  p_quantity int default 0,
  p_description text default null,
  p_reorder_level int default null,
  p_location text default null,
  p_category_id uuid default null
)
returns public.inventory_items
language plpgsql security definer set search_path to 'public'
as $$
declare
  v_school_id uuid := auth_school_id();
  v_result public.inventory_items;
begin
  if not auth_has_permission('inventory.write') then
    raise exception 'insufficient permissions: inventory.write required';
  end if;
  if p_quantity < 0 then
    raise exception 'quantity cannot be negative';
  end if;

  insert into public.inventory_items (school_id, name, description, unit, quantity, reorder_level, location, category_id)
  values (v_school_id, p_name, p_description, coalesce(nullif(p_unit, ''), 'pieces'), p_quantity, p_reorder_level, p_location, p_category_id)
  returning * into v_result;

  if p_quantity > 0 then
    insert into public.inventory_stock_movements (school_id, item_id, movement_type, quantity, reason)
    values (v_school_id, v_result.id, 'in', p_quantity, 'Opening stock recorded when item was created');
  end if;

  return v_result;
end;
$$;
