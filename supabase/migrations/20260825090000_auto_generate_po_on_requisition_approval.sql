-- Requisition approval now auto-generates the Purchase Order from exactly the
-- requested items, instead of the owner re-typing everything into "Issue
-- Purchase Order" by hand. Lucy's brief: approving a requisition (raised by
-- Main Store or the Nurse) should produce the PO automatically; if no supplier
-- can be determined for an item, approval is BLOCKED until one is supplied
-- (never silently left half-done), and the supplier is emailed immediately on
-- success, matching how manual POs already behave.
--
-- Design:
--   * Supplier/cost resolution per item mirrors the existing low-stock
--     auto-reorder trigger (20260822083939): most recent PO for that
--     inventory_item_id at this school gives the default supplier + cost.
--     A requisition's own estimated_unit_cost, if set, always wins over that
--     history for cost (it's a more current estimate than an old PO line).
--   * Items not linked to the catalog (custom/off-catalog) have no history to
--     resolve from at all -- they always need an explicit supplier.
--   * A requisition can have several items (the Nurse's request form already
--     supports multiple lines); a PO has exactly one supplier, so if the
--     items disagree on which supplier to use, or any one can't resolve one,
--     the whole approval is blocked pending an explicit p_supplier_id -- which
--     then applies to every line on this PO. p_unit_cost_override likewise
--     applies to whichever line(s) still lack a resolvable cost after the
--     requisition's own estimate and history are checked.
--   * On success the requisition moves straight from 'submitted' to
--     'converted' (never sits in an intermediate 'approved' state) since,
--     under this flow, approval and PO generation are now the same atomic
--     step -- there's no longer a scenario where a requisition is approved
--     but not yet converted.

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
    v_item_cost := coalesce(v_item.estimated_unit_cost, p_unit_cost_override);

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
    v_item_cost := coalesce(v_item.estimated_unit_cost, p_unit_cost_override);
    if v_item.inventory_item_id is not null and v_item_cost is null then
      select unit_cost into v_item_cost
      from public.purchase_order_items poi
      join public.purchase_orders po on po.id = poi.po_id
      where poi.inventory_item_id = v_item.inventory_item_id and po.school_id = v_school_id
      order by po.order_date desc, po.created_at desc
      limit 1;
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
  'Approves a submitted requisition and atomically raises + sends the PO for exactly its requested items. Raises an exception (blocking approval) if a supplier or cost cannot be resolved and none was supplied explicitly.';

-- Read-only preview so the UI can decide, before the approver clicks Approve,
-- whether it can go straight through or needs to ask for a supplier first.
-- Same resolution logic as pass 1 above, but returns rows instead of raising.
create or replace function public.preview_requisition_approval(p_requisition_id uuid)
returns table (
  item_id uuid,
  item_description text,
  quantity numeric,
  resolved_supplier_id uuid,
  resolved_supplier_name text,
  resolved_unit_cost numeric,
  needs_supplier boolean,
  needs_cost boolean
)
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_school_id uuid := auth_school_id();
  v_item record;
  v_last record;
  v_cost numeric;
  v_supplier uuid;
  v_supplier_name text;
begin
  if not auth_has_permission('inventory.procurement.approve') then
    raise exception 'insufficient permissions: inventory.procurement.approve required';
  end if;

  for v_item in
    select ri.* from public.purchase_requisition_items ri
    join public.purchase_requisitions r on r.id = ri.requisition_id
    where ri.requisition_id = p_requisition_id and r.school_id = v_school_id
    order by ri.id
  loop
    v_supplier := null;
    v_supplier_name := null;
    v_cost := v_item.estimated_unit_cost;

    if v_item.inventory_item_id is not null then
      select poi.unit_cost, po.supplier_id, s.name
      into v_last
      from public.purchase_order_items poi
      join public.purchase_orders po on po.id = poi.po_id
      join public.suppliers s on s.id = po.supplier_id
      where poi.inventory_item_id = v_item.inventory_item_id and po.school_id = v_school_id
      order by po.order_date desc, po.created_at desc
      limit 1;

      v_supplier := v_last.supplier_id;
      v_supplier_name := v_last.name;
      if v_cost is null then
        v_cost := v_last.unit_cost;
      end if;
    end if;

    item_id := v_item.id;
    item_description := v_item.item_description;
    quantity := v_item.quantity;
    resolved_supplier_id := v_supplier;
    resolved_supplier_name := v_supplier_name;
    resolved_unit_cost := v_cost;
    needs_supplier := v_supplier is null;
    needs_cost := v_cost is null;
    return next;
  end loop;
end;
$$;

revoke all on function public.preview_requisition_approval(uuid) from public, anon;
grant execute on function public.preview_requisition_approval(uuid) to authenticated;
