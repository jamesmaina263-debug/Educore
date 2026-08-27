-- Real, live bug found while investigating Lucy's report ("no option to
-- receive remaining items, stock not adjusting" on a multi-item PO):
-- record_goods_received (20260822083939) computed the whole PO's status from
-- ONLY the one line item that was just updated:
--
--   status = case when v_result.quantity_received >= v_result.quantity
--                 then 'received' else 'partially_received' end
--
-- For a single-item PO that's harmless (it's the only line). For a
-- multi-item PO, receiving just ONE fully-received line flips the *whole PO*
-- to 'received' even though every other line is still outstanding at 0 --
-- and the "Receive Goods" button only shows while status is neither
-- 'received' nor 'cancelled' (procurement-section.tsx), so the button then
-- vanishes and the remaining lines can never be received, and their stock
-- never gets posted. This bug predates the auto-PO-on-approval work
-- (PR #28) -- it just had nothing to expose it until multi-item POs became
-- routine.
--
-- Confirmed live: PO-2026-00004 (from a 4-item requisition) had exactly this
-- -- 1 of 4 lines fully received, the PO already flipped to 'received',
-- 3 lines stuck at 0 received / 0 stock with no way to receive them. Fixed
-- below, and that PO's status corrected back to 'partially_received' so the
-- Receive Goods option reappears for its remaining lines.

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
  v_actor uuid;
  v_result public.purchase_order_items;
  v_po_number text;
begin
  if not auth_has_permission('inventory.write') then
    raise exception 'insufficient permissions: inventory.write required';
  end if;
  if p_quantity_received <= 0 then
    raise exception 'quantity received must be positive';
  end if;

  select id into v_actor from public.school_users where auth_user_id = auth.uid();

  update public.purchase_order_items
  set quantity_received = quantity_received + p_quantity_received
  where id = p_po_item_id
    and school_id = v_school_id
  returning * into v_result;

  if v_result.id is null then
    raise exception 'purchase order item not found in this school';
  end if;

  -- Status reflects EVERY line on the PO, not just the one just updated --
  -- 'received' only once no line is still short of its ordered quantity.
  update public.purchase_orders po
  set status = case
        when not exists (
          select 1 from public.purchase_order_items poi
          where poi.po_id = po.id and poi.quantity_received < poi.quantity
        ) then 'received'
        else 'partially_received'
      end,
      updated_at = now()
  where po.id = p_po_id
    and po.school_id = v_school_id
  returning po_number into v_po_number;

  -- Post to stock only when this PO line is linked to a catalog item. A line
  -- for something outside the inventory catalog (e.g. a one-off service) has
  -- no inventory_items row to post against, and that's expected, not an error.
  if v_result.inventory_item_id is not null then
    perform 1 from public.inventory_items where id = v_result.inventory_item_id and school_id = v_school_id for update;
    if not found then
      raise exception 'linked inventory item not found in this school';
    end if;

    update public.inventory_items
    set quantity = quantity + p_quantity_received,
        updated_at = now()
    where id = v_result.inventory_item_id
      and school_id = v_school_id;

    insert into public.inventory_stock_movements (school_id, item_id, movement_type, quantity, reason, actor)
    values (v_school_id, v_result.inventory_item_id, 'in', p_quantity_received, 'Goods received: PO ' || coalesce(v_po_number, ''), v_actor);
  end if;

  return v_result;
end;
$$;

-- Data fix: correct the one live PO this bug already mismarked. Its 3
-- outstanding lines were never touched (quantity_received still 0, no stock
-- posted for them) -- only the status flag was wrong, so this is a pure
-- status correction, not a stock adjustment.
update public.purchase_orders po
set status = case
      when not exists (
        select 1 from public.purchase_order_items poi
        where poi.po_id = po.id and poi.quantity_received < poi.quantity
      ) then 'received'
      else 'partially_received'
    end,
    updated_at = now()
where po.status = 'received'
  and exists (
    select 1 from public.purchase_order_items poi
    where poi.po_id = po.id and poi.quantity_received < poi.quantity
  );
