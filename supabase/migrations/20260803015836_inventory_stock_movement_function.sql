create or replace function public.record_stock_movement(p_item_id uuid, p_movement_type text, p_quantity int, p_reason text default null)
returns public.inventory_items
language plpgsql security definer set search_path to 'public'
as $$
declare
  v_school_id uuid := auth_school_id();
  v_actor uuid;
  v_current int;
  v_result public.inventory_items;
begin
  if not auth_has_permission('inventory.write') then
    raise exception 'insufficient permissions: inventory.write required';
  end if;

  if p_movement_type not in ('in','out') then
    raise exception 'movement_type must be ''in'' or ''out''';
  end if;
  if p_quantity <= 0 then
    raise exception 'quantity must be positive';
  end if;

  select su.id into v_actor from school_users su where su.auth_user_id = auth.uid();

  select quantity into v_current from inventory_items where id = p_item_id and school_id = v_school_id for update;
  if v_current is null then
    raise exception 'inventory item not found in this school';
  end if;

  if p_movement_type = 'out' and v_current < p_quantity then
    raise exception 'insufficient stock: have %, requested %', v_current, p_quantity;
  end if;

  update inventory_items
  set quantity = quantity + (case when p_movement_type = 'in' then p_quantity else -p_quantity end),
      updated_at = now()
  where id = p_item_id
  returning * into v_result;

  insert into inventory_stock_movements (school_id, item_id, movement_type, quantity, reason, actor)
  values (v_school_id, p_item_id, p_movement_type, p_quantity, p_reason, v_actor);

  return v_result;
end;
$$;

revoke all on function public.record_stock_movement from public, anon;
grant execute on function public.record_stock_movement to authenticated;
