-- Bug fix in approve_requisition (20260825090000): p_unit_cost_override was
-- being folded in via `coalesce(estimated_unit_cost, p_unit_cost_override)`
-- *before* checking purchase history, so on a multi-item requisition, a cost
-- override meant to unblock ONE item with no history would silently steamroll
-- the correct historical price on any OTHER item that also lacked its own
-- estimated_unit_cost -- even one with perfectly good price history. The
-- override is meant to be the last resort (estimate, then history, then
-- override), matching what the function's own header comment already said --
-- the implementation just didn't do that. No live approvals have gone
-- through yet, so nothing has actually been corrupted by this.
--
-- Fix: check history before folding in the override, in both the resolution
-- pass and the pass that actually writes the PO items.

create or replace function public.approve_requisition(
  p_requisition_id uuid,
  p_supplier_id uuid default null,
  p_unit_cost_override numeric default null
)
returns public.purchase_orders
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_school_id uuid := auth_school_id();
  v_actor uuid := auth_school_user_id();
  v_req record;
  v_item record;
  v_resolved_supplier uuid;
  v_conflicting boolean := false;
  v_missing_supplier_items text := '';
  v_missing_cost_items text := '';
  v_po_id uuid;
  v_po public.purchase_orders;
  v_last record;
  v_item_cost numeric;
  v_item_supplier uuid;
begin
  if not auth_has_permission('inventory.procurement.approve') then
    raise exception 'insufficient permissions: inventory.procurement.approve required';
  end if;

  select * into v_req
  from public.purchase_requisitions
  where id = p_requisition_id and school_id = v_school_id
  for update;

  if v_req.id is null then
    raise exception 'requisition not found in this school';
  end if;
  if v_req.status <> 'submitted' then
    raise exception 'requisition is not awaiting approval (status: %)', v_req.status;
  end if;

  -- Pass 1: resolve each item's supplier + cost, without writing anything yet.
  -- Collect what's missing so a single clear error can be raised if approval
  -- can't proceed, rather than failing on the first problem line only.
  for v_item in
    select * from public.purchase_requisition_items where requisition_id = p_requisition_id order by id
  loop
    v_item_supplier := null;
    -- Priority: the requisition's own estimate, then this item's own
    -- purchase history, and only then the approver's override -- the
    -- override must never steamroll a real historical price on a *different*
    -- line than the one it was meant to unblock.
    v_item_cost := v_item.estimated_unit_cost;

    if v_item.inventory_item_id is not null then
      select poi.quantity, poi.unit_cost, po.supplier_id
      into v_last
      from public.purchase_order_items poi
      join public.purchase_orders po on po.id = poi.po_id
      where poi.inventory_item_id = v_item.inventory_item_id
        and po.school_id = v_school_id
      order by po.order_date desc, po.created_at desc
      limit 1;

      v_item_supplier := v_last.supplier_id;
      if v_item_cost is null then
        v_item_cost := v_last.unit_cost;
      end if;
    end if;

    if v_item_cost is null then
      v_item_cost := p_unit_cost_override;
    end if;

    -- An explicit p_supplier_id always overrides whatever history suggested
    -- (the approver picking one because auto-resolution failed or disagreed).
    if p_supplier_id is not null then
      v_item_supplier := p_supplier_id;
    end if;

    if v_item_supplier is null then
      v_missing_supplier_items := v_missing_supplier_items || case when v_missing_supplier_items = '' then '' else ', ' end || v_item.item_description;
    elsif v_resolved_supplier is null then
      v_resolved_supplier := v_item_supplier;
    elsif v_resolved_supplier <> v_item_supplier then
      v_conflicting := true;
    end if;

    if v_item_cost is null then
      v_missing_cost_items := v_missing_cost_items || case when v_missing_cost_items = '' then '' else ', ' end || v_item.item_description;
    end if;
  end loop;

  if v_missing_supplier_items <> '' or v_conflicting then
    raise exception 'Cannot auto-approve: no supplier on file for % -- select a supplier and try again.',
      case when v_missing_supplier_items <> '' then v_missing_supplier_items else 'these items (they resolve to different suppliers)' end;
  end if;
  if v_missing_cost_items <> '' then
    raise exception 'Cannot auto-approve: no unit cost on file for % -- provide a cost and try again.', v_missing_cost_items;
  end if;
  if v_resolved_supplier is null then
    raise exception 'Cannot auto-approve: requisition has no items.';
  end if;

  -- Pass 2: everything resolved -- create the PO + lines for real.
  insert into public.purchase_orders (school_id, requisition_id, supplier_id, status, created_by)
  values (v_school_id, p_requisition_id, v_resolved_supplier, 'sent', v_actor)
  returning id into v_po_id;

  for v_item in
    select * from public.purchase_requisition_items where requisition_id = p_requisition_id order by id
  loop
    v_item_cost := v_item.estimated_unit_cost;
    if v_item.inventory_item_id is not null and v_item_cost is null then
      select unit_cost into v_item_cost
      from public.purchase_order_items poi
      join public.purchase_orders po on po.id = poi.po_id
      where poi.inventory_item_id = v_item.inventory_item_id and po.school_id = v_school_id
      order by po.order_date desc, po.created_at desc
      limit 1;
    end if;
    if v_item_cost is null then
      v_item_cost := p_unit_cost_override;
    end if;

    insert into public.purchase_order_items (po_id, school_id, item_description, quantity, unit_cost, inventory_item_id)
    values (v_po_id, v_school_id, v_item.item_description, v_item.quantity, v_item_cost, v_item.inventory_item_id);
  end loop;

  update public.purchase_requisitions
  set status = 'converted',
      approved_by = v_actor,
      approved_at = now(),
      updated_at = now()
  where id = p_requisition_id;

  perform public._queue_supplier_po_email(v_po_id, v_school_id);

  if v_req.requested_by is not null then
    perform public.notify_school_user(
      p_recipient_id => v_req.requested_by,
      p_subject => 'Requisition approved',
      p_body => 'Your requisition for "' || v_req.purpose || '" was approved and a purchase order has been raised automatically.',
      p_action_url => case
        when public.school_user_has_permission(v_req.requested_by, 'inventory.read_any') then '/inventory/procurement'
        else '/health/inventory'
      end,
      p_category => 'other'
    );
  end if;

  select * into v_po from public.purchase_orders where id = v_po_id;
  return v_po;
end;
$$;

revoke all on function public.approve_requisition(uuid, uuid, numeric) from public, anon;
grant execute on function public.approve_requisition(uuid, uuid, numeric) to authenticated;

comment on function public.approve_requisition(uuid, uuid, numeric) is
  'Approves a submitted requisition and atomically raises + sends the PO for exactly its requested items. Raises an exception (blocking approval) if a supplier or cost cannot be resolved and none was supplied explicitly. Cost priority per item: requisition estimate, then purchase history, then p_unit_cost_override as a last resort.';
