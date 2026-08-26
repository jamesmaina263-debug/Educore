-- Lucy's ask: Main Store transferring stock to Health should (1) only ever
-- be allowed for Medical Supplies items -- today nothing stops picking any
-- catalog item at all, and the Nurse's own view already silently filters
-- non-medical transfers out client-side (health/_data.ts), which just leaves
-- a permanently-invisible pending transfer instead of actually preventing
-- the mistake -- and (2) let the officer send several items in one action
-- instead of repeating "Transfer to Health" once per item.
--
-- The Nurse's side already does exactly what was asked for receiving: each
-- inventory_transfers row is accepted or rejected individually
-- (accept_inventory_transfer), and accepting one already atomically moves
-- stock out of Main Store and into health_inventory_stock. So "receive one
-- by one, auto-adjust stock" doesn't need any change on that side -- the fix
-- here is entirely about how a batch of items gets INTO that table: one
-- inventory_transfers row per item, created together, each then received
-- independently exactly as before.

drop function if exists public.create_inventory_transfer(uuid, integer);

create or replace function public.create_inventory_transfers(p_items jsonb)
returns void
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_school_id uuid := auth_school_id();
  v_actor uuid;
  v_medical_category_id uuid;
  v_item jsonb;
  v_item_id uuid;
  v_quantity int;
  v_current_qty int;
  v_item_name text;
  v_category_id uuid;
  v_invalid_category_items text := '';
  v_insufficient_stock_items text := '';
begin
  if not auth_has_permission('inventory.write') then
    raise exception 'insufficient permissions: inventory.write required';
  end if;
  if p_items is null or jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) = 0 then
    raise exception 'at least one item is required';
  end if;

  select id into v_actor from public.school_users where auth_user_id = auth.uid();
  select id into v_medical_category_id from public.inventory_categories where school_id = v_school_id and name = 'Medical Supplies';

  -- Pass 1: validate every item (category + stock) before writing anything --
  -- all-or-nothing, so a mistake on one line never leaves a partial batch of
  -- transfers behind. Row-locks each item so a concurrent double-submit
  -- can't both pass the stock check against the same starting quantity.
  for v_item in select * from jsonb_array_elements(p_items)
  loop
    v_item_id := (v_item->>'item_id')::uuid;
    v_quantity := (v_item->>'quantity')::int;

    if v_quantity is null or v_quantity <= 0 then
      raise exception 'quantity must be positive for every item';
    end if;

    select quantity, name, category_id into v_current_qty, v_item_name, v_category_id
    from public.inventory_items
    where id = v_item_id and school_id = v_school_id
    for update;

    if v_item_name is null then
      raise exception 'inventory item not found in this school';
    end if;

    if v_medical_category_id is null or v_category_id is distinct from v_medical_category_id then
      v_invalid_category_items := v_invalid_category_items || case when v_invalid_category_items = '' then '' else ', ' end || v_item_name;
    end if;

    if v_current_qty < v_quantity then
      v_insufficient_stock_items := v_insufficient_stock_items
        || case when v_insufficient_stock_items = '' then '' else ', ' end
        || format('%s (has %s, requested %s)', v_item_name, v_current_qty, v_quantity);
    end if;
  end loop;

  if v_invalid_category_items <> '' then
    raise exception 'Only Medical Supplies items can be transferred to Health -- not: %', v_invalid_category_items;
  end if;
  if v_insufficient_stock_items <> '' then
    raise exception 'Main Store does not have enough stock for: %', v_insufficient_stock_items;
  end if;

  -- Pass 2: everything validated -- create one transfer row per item. Each
  -- one is then accepted/rejected by the Nurse independently, exactly as a
  -- single transfer always has been.
  for v_item in select * from jsonb_array_elements(p_items)
  loop
    insert into public.inventory_transfers (school_id, item_id, quantity_requested, initiated_by)
    values (v_school_id, (v_item->>'item_id')::uuid, (v_item->>'quantity')::int, v_actor);
  end loop;
end;
$$;

comment on function public.create_inventory_transfers(jsonb) is
  'Creates one inventory_transfers row per {item_id, quantity} in p_items, all-or-nothing. Every item must belong to the Medical Supplies category and have enough stock at Main Store, checked up front before any row is written. Each resulting transfer is then accepted/rejected individually by the Nurse via accept_inventory_transfer/reject_inventory_transfer, unchanged.';

revoke all on function public.create_inventory_transfers(jsonb) from public, anon;
grant execute on function public.create_inventory_transfers(jsonb) to authenticated;
