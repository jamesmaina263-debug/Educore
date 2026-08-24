-- create_inventory_transfer let Main Store request a transfer for more than (or none of) what
-- it actually holds -- e.g. a pending transfer for 90 "crept bandages" while Main Store had 0.
-- accept_inventory_transfer already blocks the stock from actually moving in that case, but the
-- request should never be created in the first place -- "you cannot give what you don't have".
-- Matches the same row-locked availability check accept_inventory_transfer already uses.
create or replace function public.create_inventory_transfer(p_item_id uuid, p_quantity int)
returns public.inventory_transfers
language plpgsql security definer set search_path to 'public'
as $$
declare
  v_school_id uuid := auth_school_id();
  v_actor uuid;
  v_current_qty int;
  v_result public.inventory_transfers;
begin
  if not auth_has_permission('inventory.write') then
    raise exception 'insufficient permissions: inventory.write required';
  end if;
  if p_quantity <= 0 then
    raise exception 'quantity must be positive';
  end if;

  select quantity into v_current_qty from public.inventory_items where id = p_item_id and school_id = v_school_id for update;
  if v_current_qty is null then
    raise exception 'inventory item not found in this school';
  end if;
  if v_current_qty < p_quantity then
    raise exception 'main store does not have % units available (has %)', p_quantity, v_current_qty;
  end if;

  select id into v_actor from public.school_users where auth_user_id = auth.uid();

  insert into public.inventory_transfers (school_id, item_id, quantity_requested, initiated_by)
  values (v_school_id, p_item_id, p_quantity, v_actor)
  returning * into v_result;

  return v_result;
end;
$$;
