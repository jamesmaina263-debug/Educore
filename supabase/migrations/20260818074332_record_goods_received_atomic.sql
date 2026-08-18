-- receiveGoodsAction() was reading purchase_order_items.quantity_received in the
-- app, adding to it in JS, then writing it back -- a classic read-modify-write
-- race: two people receiving against the same PO line at the same moment could
-- both read the same starting value and one increment would be lost, silently
-- under-recording how much was actually received. Same class as the row-locking
-- already used in record_stock_movement/accept_inventory_transfer elsewhere in
-- this app -- just missing here. Making it atomic with a single row-locked
-- UPDATE ... RETURNING, matching that existing pattern.

create or replace function public.record_goods_received(
  p_po_id uuid,
  p_po_item_id uuid,
  p_quantity_received integer
)
returns purchase_order_items
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_school_id uuid := auth_school_id();
  v_result public.purchase_order_items;
  v_full_qty numeric;
begin
  if not auth_has_permission('inventory.write') then
    raise exception 'insufficient permissions: inventory.write required';
  end if;
  if p_quantity_received <= 0 then
    raise exception 'quantity received must be positive';
  end if;

  update public.purchase_order_items
  set quantity_received = quantity_received + p_quantity_received
  where id = p_po_item_id
    and school_id = v_school_id
  returning * into v_result;

  if v_result.id is null then
    raise exception 'purchase order item not found in this school';
  end if;

  update public.purchase_orders
  set status = case when v_result.quantity_received >= v_result.quantity then 'received' else 'partially_received' end,
      updated_at = now()
  where id = p_po_id
    and school_id = v_school_id;

  return v_result;
end;
$$;
