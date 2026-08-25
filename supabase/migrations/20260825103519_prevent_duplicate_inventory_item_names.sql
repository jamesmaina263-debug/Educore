-- No duplicate-checking existed on item names at all -- not even exact-match --
-- which let "Bandages (roll)", "crept bandages", and "Crept bandage" (x2) all
-- exist as separate catalog rows for the same physical item, fragmenting
-- stock and history. Add a case/whitespace-insensitive unique index as the
-- hard guarantee, and a friendly check in both creation paths so the error
-- points at the existing item instead of a raw constraint violation.
create unique index inventory_items_school_name_ci_idx
  on public.inventory_items (school_id, lower(trim(name)));

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
  v_existing_name text;
begin
  if not auth_has_permission('inventory.write') then
    raise exception 'insufficient permissions: inventory.write required';
  end if;
  if p_quantity < 0 then
    raise exception 'quantity cannot be negative';
  end if;

  select name into v_existing_name from public.inventory_items
  where school_id = v_school_id and lower(trim(name)) = lower(trim(p_name));
  if v_existing_name is not null then
    raise exception 'an item named "%" already exists -- use that item instead of creating a duplicate', v_existing_name;
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

create or replace function public.create_health_inventory_item(
  p_name text,
  p_unit text,
  p_reorder_level int default null,
  p_expiry_date date default null,
  p_category_id uuid default null
)
returns public.inventory_items
language plpgsql security definer set search_path to 'public'
as $$
declare
  v_school_id uuid := auth_school_id();
  v_result public.inventory_items;
  v_existing_name text;
begin
  if not auth_has_permission('inventory.health.issue') then
    raise exception 'insufficient permissions: inventory.health.issue required';
  end if;
  if p_name is null or length(trim(p_name)) = 0 then
    raise exception 'item name is required';
  end if;

  select name into v_existing_name from public.inventory_items
  where school_id = v_school_id and lower(trim(name)) = lower(trim(p_name));
  if v_existing_name is not null then
    raise exception 'an item named "%" already exists -- use that item instead of creating a duplicate', v_existing_name;
  end if;

  insert into public.inventory_items (school_id, name, unit, quantity, reorder_level, expiry_date, category_id)
  values (v_school_id, p_name, coalesce(p_unit, 'pieces'), 0, p_reorder_level, p_expiry_date, p_category_id)
  returning * into v_result;

  return v_result;
end;
$$;
