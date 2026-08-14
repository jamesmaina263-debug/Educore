-- Rectify list item 2: the Nurse must not be able to add stock directly. Confirmed the exact
-- root cause: migration 20260809172356 ("nurse_inventory_write_permission") granted the Nurse
-- role full, unrestricted inventory.write -- the same permission Main Store itself uses -- as
-- what was presumably a quick fix to let her manage medical stock at all. That's exactly what
-- let the Health module's +In button work. This migration revokes that grant and replaces it
-- with a narrower model: Main Store keeps unrestricted add/remove on its own stock (confirmed
-- with Lucy -- Main Store remains the unrestricted source of truth), the Nurse gets her own
-- separate stock pool that can only grow via an accepted transfer FROM Main Store, and can only
-- shrink by her issuing/removing stock (e.g. to a student).

-- ============================================================================
-- 1. The Nurse's own stock pool -- deliberately a second table, not a generalized
--    N-location model. inventory_items.quantity keeps meaning exactly what it always has
--    ("how much Main Store currently holds"), so nothing that already reads it (the main
--    Inventory page, the Dashboard's low-stock KPI, Educore AI's low_stock_inventory intent)
--    needs to change at all -- their oversight view of Main Store's own stock stays accurate
--    (and is *more* accurate afterward: stock that has physically left for the clinic no
--    longer inflates Main Store's own count).
-- ============================================================================
create table public.health_inventory_stock (
  id uuid primary key default gen_random_uuid(),
  school_id uuid not null references public.schools(id),
  item_id uuid not null references public.inventory_items(id),
  quantity int not null default 0 check (quantity >= 0),
  updated_at timestamptz not null default now(),
  unique (item_id)
);
comment on table public.health_inventory_stock is
  'The Nurse''s own stock pool, separate from inventory_items.quantity (Main Store). Only ever changed via accept_inventory_transfer (increase) or issue_health_stock (decrease) -- no direct client insert/update policy, both are SECURITY DEFINER RPCs gated on inventory.health.issue.';

create index health_inventory_stock_school_idx on public.health_inventory_stock(school_id);

alter table public.health_inventory_stock enable row level security;

create policy health_inventory_stock_select on public.health_inventory_stock
  for select using (
    auth_is_super_admin()
    or (school_id = auth_school_id() and (auth_has_permission('health.read_any') or auth_has_permission('inventory.read_any')))
  );
-- No insert/update/delete policy for any role -- writes only via the RPCs below (SECURITY
-- DEFINER, bypasses RLS as the function owner), same immutable-except-via-RPC pattern as
-- audit_log and payroll_records.

-- ============================================================================
-- 2. Transfers: Main Store initiates (no stock movement yet), the Nurse accepts (stock moves,
--    using the quantity she actually confirmed on physical count, which may differ from what
--    was requested) or rejects (nothing moves -- it was never removed from Main Store).
-- ============================================================================
create table public.inventory_transfers (
  id uuid primary key default gen_random_uuid(),
  school_id uuid not null references public.schools(id),
  item_id uuid not null references public.inventory_items(id),
  quantity_requested int not null check (quantity_requested > 0),
  quantity_confirmed int check (quantity_confirmed >= 0),
  status text not null default 'pending' check (status in ('pending', 'accepted', 'rejected')),
  initiated_by uuid references public.school_users(id),
  initiated_at timestamptz not null default now(),
  accepted_by uuid references public.school_users(id),
  accepted_at timestamptz,
  rejected_by uuid references public.school_users(id),
  rejected_at timestamptz,
  rejection_reason text
);

create index inventory_transfers_school_status_idx on public.inventory_transfers(school_id, status);

alter table public.inventory_transfers enable row level security;

create policy inventory_transfers_select on public.inventory_transfers
  for select using (
    auth_is_super_admin()
    or (school_id = auth_school_id() and (auth_has_permission('inventory.write') or auth_has_permission('inventory.health.issue') or auth_has_permission('health.read_any')))
  );
create policy inventory_transfers_insert on public.inventory_transfers
  for insert with check (auth_is_super_admin() or (school_id = auth_school_id() and auth_has_permission('inventory.write')));
-- No update/delete policy -- accept/reject only via the RPCs below.

alter table public.inventory_stock_movements
  add column location text not null default 'main_store' check (location in ('main_store', 'health')),
  add column transfer_id uuid references public.inventory_transfers(id);
comment on column public.inventory_stock_movements.location is
  'Which stock pool this movement happened against. Existing rows all default to main_store (accurate -- health_inventory_stock did not exist before this migration, so every prior movement really was at Main Store).';

-- ============================================================================
-- 3. Permissions: revoke the Nurse's blanket inventory.write, grant a narrow
--    inventory.health.issue instead.
-- ============================================================================
update public.role_permissions
set allowed = false
where permission_key = 'inventory.write'
  and role_id in (select id from public.roles where name = 'nurse');

insert into public.role_permissions (role_id, school_id, permission_key, allowed)
select r.id, s.id, 'inventory.health.issue', true
from public.roles r
cross join public.schools s
where r.name = 'nurse'
  and not exists (
    select 1 from public.role_permissions rp
    where rp.role_id = r.id and rp.school_id = s.id and rp.permission_key = 'inventory.health.issue'
  );

-- ============================================================================
-- 4. RPCs
-- ============================================================================

create or replace function public.create_inventory_transfer(p_item_id uuid, p_quantity int)
returns public.inventory_transfers
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_school_id uuid := auth_school_id();
  v_actor uuid;
  v_result public.inventory_transfers;
begin
  if not auth_has_permission('inventory.write') then
    raise exception 'insufficient permissions: inventory.write required';
  end if;
  if p_quantity <= 0 then
    raise exception 'quantity must be positive';
  end if;
  if not exists (select 1 from public.inventory_items where id = p_item_id and school_id = v_school_id) then
    raise exception 'inventory item not found in this school';
  end if;

  select id into v_actor from public.school_users where auth_user_id = auth.uid();

  insert into public.inventory_transfers (school_id, item_id, quantity_requested, initiated_by)
  values (v_school_id, p_item_id, p_quantity, v_actor)
  returning * into v_result;

  return v_result;
end;
$$;

create or replace function public.accept_inventory_transfer(p_transfer_id uuid, p_quantity_confirmed int)
returns public.inventory_transfers
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_school_id uuid := auth_school_id();
  v_actor uuid;
  v_transfer public.inventory_transfers;
  v_main_store_qty int;
  v_result public.inventory_transfers;
begin
  if not auth_has_permission('inventory.health.issue') then
    raise exception 'insufficient permissions: inventory.health.issue required';
  end if;
  if p_quantity_confirmed <= 0 then
    raise exception 'confirmed quantity must be positive';
  end if;

  select * into v_transfer from public.inventory_transfers where id = p_transfer_id and school_id = v_school_id for update;
  if v_transfer.id is null then
    raise exception 'transfer not found in this school';
  end if;
  if v_transfer.status != 'pending' then
    raise exception 'transfer is already %', v_transfer.status;
  end if;

  select quantity into v_main_store_qty from public.inventory_items where id = v_transfer.item_id for update;
  if v_main_store_qty is null or v_main_store_qty < p_quantity_confirmed then
    raise exception 'main store does not have % units available (has %)', p_quantity_confirmed, coalesce(v_main_store_qty, 0);
  end if;

  select id into v_actor from public.school_users where auth_user_id = auth.uid();

  update public.inventory_items set quantity = quantity - p_quantity_confirmed, updated_at = now() where id = v_transfer.item_id;

  insert into public.health_inventory_stock (school_id, item_id, quantity)
  values (v_school_id, v_transfer.item_id, p_quantity_confirmed)
  on conflict (item_id) do update set quantity = health_inventory_stock.quantity + excluded.quantity, updated_at = now();

  insert into public.inventory_stock_movements (school_id, item_id, movement_type, quantity, reason, actor, location, transfer_id)
  values
    (v_school_id, v_transfer.item_id, 'out', p_quantity_confirmed, 'Transfer to Health', v_actor, 'main_store', p_transfer_id),
    (v_school_id, v_transfer.item_id, 'in', p_quantity_confirmed, 'Transfer from Main Store', v_actor, 'health', p_transfer_id);

  update public.inventory_transfers
  set status = 'accepted', quantity_confirmed = p_quantity_confirmed, accepted_by = v_actor, accepted_at = now()
  where id = p_transfer_id
  returning * into v_result;

  return v_result;
end;
$$;

create or replace function public.reject_inventory_transfer(p_transfer_id uuid, p_reason text)
returns public.inventory_transfers
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_school_id uuid := auth_school_id();
  v_actor uuid;
  v_result public.inventory_transfers;
begin
  if not auth_has_permission('inventory.health.issue') then
    raise exception 'insufficient permissions: inventory.health.issue required';
  end if;
  if p_reason is null or length(trim(p_reason)) = 0 then
    raise exception 'a reason is required to reject a transfer';
  end if;

  select id into v_actor from public.school_users where auth_user_id = auth.uid();

  update public.inventory_transfers
  set status = 'rejected', rejected_by = v_actor, rejected_at = now(), rejection_reason = p_reason
  where id = p_transfer_id and school_id = v_school_id and status = 'pending'
  returning * into v_result;

  if v_result.id is null then
    raise exception 'transfer not found, not in this school, or already decided';
  end if;

  return v_result;
end;
$$;

create or replace function public.issue_health_stock(p_item_id uuid, p_quantity int, p_reason text default null)
returns public.health_inventory_stock
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_school_id uuid := auth_school_id();
  v_actor uuid;
  v_current int;
  v_result public.health_inventory_stock;
begin
  if not auth_has_permission('inventory.health.issue') then
    raise exception 'insufficient permissions: inventory.health.issue required';
  end if;
  if p_quantity <= 0 then
    raise exception 'quantity must be positive';
  end if;

  select quantity into v_current from public.health_inventory_stock where item_id = p_item_id and school_id = v_school_id for update;
  if v_current is null or v_current < p_quantity then
    raise exception 'insufficient stock in health inventory: have %, requested %', coalesce(v_current, 0), p_quantity;
  end if;

  select id into v_actor from public.school_users where auth_user_id = auth.uid();

  update public.health_inventory_stock
  set quantity = quantity - p_quantity, updated_at = now()
  where item_id = p_item_id and school_id = v_school_id
  returning * into v_result;

  insert into public.inventory_stock_movements (school_id, item_id, movement_type, quantity, reason, actor, location)
  values (v_school_id, p_item_id, 'out', p_quantity, p_reason, v_actor, 'health');

  return v_result;
end;
$$;

-- Replaces the raw table insert the "Add medical item" button used to make directly (which
-- required inventory.write, now revoked from the Nurse) -- same effect (a new catalog entry at
-- zero quantity; defining what kind of item exists is not the same as adding stock), narrower
-- gate.
create or replace function public.create_health_inventory_item(
  p_name text,
  p_unit text,
  p_reorder_level int default null,
  p_expiry_date date default null,
  p_category_id uuid default null
)
returns public.inventory_items
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_school_id uuid := auth_school_id();
  v_result public.inventory_items;
begin
  if not auth_has_permission('inventory.health.issue') then
    raise exception 'insufficient permissions: inventory.health.issue required';
  end if;
  if p_name is null or length(trim(p_name)) = 0 then
    raise exception 'item name is required';
  end if;

  insert into public.inventory_items (school_id, name, unit, quantity, reorder_level, expiry_date, category_id)
  values (v_school_id, p_name, coalesce(p_unit, 'pieces'), 0, p_reorder_level, p_expiry_date, p_category_id)
  returning * into v_result;

  return v_result;
end;
$$;
