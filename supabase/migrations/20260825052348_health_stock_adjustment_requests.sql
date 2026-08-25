-- James: let the Nurse add stock manually, but require owner/principal/deputy
-- approval before it actually posts. Reuses inventory.procurement.approve --
-- already exactly owner/principal/deputy by default, same as the existing
-- procurement-requisition approval flow -- rather than inventing a new
-- permission key for the same set of approvers.
create table public.health_stock_adjustment_requests (
  id uuid primary key default gen_random_uuid(),
  school_id uuid not null references public.schools(id),
  item_id uuid not null references public.inventory_items(id),
  quantity int not null check (quantity > 0),
  reason text not null,
  status text not null default 'pending' check (status in ('pending','approved','rejected')),
  requested_by uuid references public.school_users(id),
  reviewed_by uuid references public.school_users(id),
  reviewed_at timestamptz,
  rejection_reason text,
  created_at timestamptz not null default now()
);

create index health_stock_adjustment_requests_school_status_idx
  on public.health_stock_adjustment_requests (school_id, status);

alter table public.health_stock_adjustment_requests enable row level security;

create policy health_stock_adjustment_requests_select on public.health_stock_adjustment_requests
  for select
  using (
    auth_is_super_admin()
    or (
      school_id = auth_school_id()
      and (auth_has_permission('inventory.health.issue') or auth_has_permission('inventory.procurement.approve'))
    )
  );

-- Real authorization happens inside the SECURITY DEFINER functions below, same
-- pattern already used for inventory_transfers_insert elsewhere in this schema.
create policy health_stock_adjustment_requests_insert on public.health_stock_adjustment_requests
  for insert
  with check (true);

create or replace function public.request_health_stock_adjustment(p_item_id uuid, p_quantity int, p_reason text)
returns public.health_stock_adjustment_requests
language plpgsql security definer set search_path to 'public'
as $$
declare
  v_school_id uuid := auth_school_id();
  v_actor uuid;
  v_result public.health_stock_adjustment_requests;
begin
  if not auth_has_permission('inventory.health.issue') then
    raise exception 'insufficient permissions: inventory.health.issue required';
  end if;
  if p_quantity <= 0 then
    raise exception 'quantity must be positive';
  end if;
  if p_reason is null or length(trim(p_reason)) = 0 then
    raise exception 'a reason is required';
  end if;
  if not exists (select 1 from public.inventory_items where id = p_item_id and school_id = v_school_id) then
    raise exception 'item not found in this school';
  end if;

  select id into v_actor from public.school_users where auth_user_id = auth.uid();

  insert into public.health_stock_adjustment_requests (school_id, item_id, quantity, reason, requested_by)
  values (v_school_id, p_item_id, p_quantity, p_reason, v_actor)
  returning * into v_result;

  return v_result;
end;
$$;

create or replace function public.approve_health_stock_adjustment(p_request_id uuid)
returns public.health_stock_adjustment_requests
language plpgsql security definer set search_path to 'public'
as $$
declare
  v_school_id uuid := auth_school_id();
  v_actor uuid;
  v_req public.health_stock_adjustment_requests;
  v_result public.health_stock_adjustment_requests;
begin
  if not auth_has_permission('inventory.procurement.approve') then
    raise exception 'insufficient permissions: inventory.procurement.approve required';
  end if;

  select * into v_req from public.health_stock_adjustment_requests where id = p_request_id and school_id = v_school_id for update;
  if v_req.id is null then
    raise exception 'request not found in this school';
  end if;
  if v_req.status != 'pending' then
    raise exception 'request is already %', v_req.status;
  end if;

  select id into v_actor from public.school_users where auth_user_id = auth.uid();

  insert into public.health_inventory_stock (school_id, item_id, quantity)
  values (v_school_id, v_req.item_id, v_req.quantity)
  on conflict (item_id) do update set quantity = health_inventory_stock.quantity + excluded.quantity, updated_at = now();

  insert into public.inventory_stock_movements (school_id, item_id, movement_type, quantity, reason, actor, location)
  values (v_school_id, v_req.item_id, 'in', v_req.quantity, 'Manual stock addition approved: ' || v_req.reason, v_actor, 'health');

  update public.health_stock_adjustment_requests
  set status = 'approved', reviewed_by = v_actor, reviewed_at = now()
  where id = p_request_id
  returning * into v_result;

  return v_result;
end;
$$;

create or replace function public.reject_health_stock_adjustment(p_request_id uuid, p_reason text default null)
returns public.health_stock_adjustment_requests
language plpgsql security definer set search_path to 'public'
as $$
declare
  v_school_id uuid := auth_school_id();
  v_actor uuid;
  v_req public.health_stock_adjustment_requests;
  v_result public.health_stock_adjustment_requests;
begin
  if not auth_has_permission('inventory.procurement.approve') then
    raise exception 'insufficient permissions: inventory.procurement.approve required';
  end if;

  select * into v_req from public.health_stock_adjustment_requests where id = p_request_id and school_id = v_school_id for update;
  if v_req.id is null then
    raise exception 'request not found in this school';
  end if;
  if v_req.status != 'pending' then
    raise exception 'request is already %', v_req.status;
  end if;

  select id into v_actor from public.school_users where auth_user_id = auth.uid();

  update public.health_stock_adjustment_requests
  set status = 'rejected', reviewed_by = v_actor, reviewed_at = now(), rejection_reason = p_reason
  where id = p_request_id
  returning * into v_result;

  return v_result;
end;
$$;
