-- OS-08 (GTM Readiness Protocol) verification found real gaps beyond the
-- biometric kiosk's already-idempotent event_id pattern: library loan issuance,
-- inventory/health stock movements, and medication administration all had no
-- protection against a lost-ack offline-queue retry creating a genuine duplicate
-- (a second loan + double stock deduction, a doubled stock movement, or a
-- doubled medication dose on a student's record). Attendance/staff-attendance
-- (unique constraint, blocks outright), boarding roll call and exam marks
-- (upsert, silently idempotent), and the admissions wizard's field-saves
-- (update-by-id, naturally idempotent) were all already safe -- confirmed by
-- reading each, not assumed.
--
-- Fix: an optional client-supplied client_mutation_id, same shape as the
-- biometric kiosk's device_id+event_id -- generated once by the browser at
-- queue time, stored with the payload, and naturally reused on every replay
-- attempt since the offline queue persists and resends the exact same payload
-- object. Each RPC checks for a prior row with the same key first and returns
-- it directly (skipping the side effects a second time) rather than either
-- erroring or duplicating.

alter table public.inventory_stock_movements add column if not exists client_mutation_id uuid;
create unique index if not exists inventory_stock_movements_school_client_mutation_id_key
  on public.inventory_stock_movements (school_id, client_mutation_id)
  where client_mutation_id is not null;

alter table public.library_loans add column if not exists client_mutation_id uuid;
create unique index if not exists library_loans_school_client_mutation_id_key
  on public.library_loans (school_id, client_mutation_id)
  where client_mutation_id is not null;

alter table public.medication_administrations add column if not exists client_mutation_id uuid;
create unique index if not exists medication_admin_school_client_mutation_id_key
  on public.medication_administrations (school_id, client_mutation_id)
  where client_mutation_id is not null;

-- record_stock_movement: check inventory_stock_movements for the key first.
create or replace function public.record_stock_movement(
  p_item_id uuid, p_movement_type text, p_quantity integer, p_reason text default null,
  p_client_mutation_id uuid default null
)
returns inventory_items
language plpgsql
security definer
set search_path = 'public'
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

  if p_client_mutation_id is not null and exists (
    select 1 from inventory_stock_movements
    where school_id = v_school_id and client_mutation_id = p_client_mutation_id
  ) then
    select * into v_result from inventory_items where id = p_item_id and school_id = v_school_id;
    return v_result;
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

  insert into inventory_stock_movements (school_id, item_id, movement_type, quantity, reason, actor, client_mutation_id)
  values (v_school_id, p_item_id, p_movement_type, p_quantity, p_reason, v_actor, p_client_mutation_id);

  return v_result;
end;
$$;

-- issue_health_stock: same inventory_stock_movements table, same key check (location='health' rows).
create or replace function public.issue_health_stock(
  p_item_id uuid, p_quantity integer, p_reason text default null,
  p_client_mutation_id uuid default null
)
returns health_inventory_stock
language plpgsql
security definer
set search_path = 'public'
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

  if p_client_mutation_id is not null and exists (
    select 1 from inventory_stock_movements
    where school_id = v_school_id and client_mutation_id = p_client_mutation_id
  ) then
    select * into v_result from public.health_inventory_stock where item_id = p_item_id and school_id = v_school_id;
    return v_result;
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

  insert into public.inventory_stock_movements (school_id, item_id, movement_type, quantity, reason, actor, location, client_mutation_id)
  values (v_school_id, p_item_id, 'out', p_quantity, p_reason, v_actor, 'health', p_client_mutation_id);

  return v_result;
end;
$$;

-- issue_library_loan: check library_loans for the key first.
create or replace function public.issue_library_loan(
  p_item_id uuid, p_student_id uuid, p_due_date date,
  p_client_mutation_id uuid default null
)
returns library_loans
language plpgsql
security definer
set search_path = 'public'
as $$
declare
  v_school_id uuid := auth_school_id();
  v_issued_by uuid;
  v_available int;
  v_result public.library_loans;
begin
  if not auth_has_permission('library.write') then
    raise exception 'insufficient permissions: library.write required';
  end if;

  if not exists (select 1 from students where id = p_student_id and school_id = v_school_id) then
    raise exception 'student not found in this school';
  end if;

  if p_client_mutation_id is not null then
    select * into v_result from library_loans
    where school_id = v_school_id and client_mutation_id = p_client_mutation_id;
    if found then
      return v_result;
    end if;
  end if;

  select su.id into v_issued_by from school_users su where su.auth_user_id = auth.uid();

  select available_copies into v_available from library_items where id = p_item_id and school_id = v_school_id for update;
  if v_available is null then
    raise exception 'library item not found in this school';
  end if;
  if v_available < 1 then
    raise exception 'no copies available for this item';
  end if;

  update library_items set available_copies = available_copies - 1, updated_at = now() where id = p_item_id;

  insert into library_loans (school_id, library_item_id, student_id, issued_by, due_date, client_mutation_id)
  values (v_school_id, p_item_id, p_student_id, v_issued_by, p_due_date, p_client_mutation_id)
  returning * into v_result;

  return v_result;
end;
$$;

-- issue_library_loan_to_staff: same pattern.
create or replace function public.issue_library_loan_to_staff(
  p_item_id uuid, p_staff_id uuid, p_due_date date,
  p_client_mutation_id uuid default null
)
returns library_loans
language plpgsql
security definer
set search_path = 'public'
as $$
declare
  v_school_id uuid := auth_school_id();
  v_issued_by uuid;
  v_available int;
  v_result public.library_loans;
begin
  if not auth_has_permission('library.write') then
    raise exception 'insufficient permissions: library.write required';
  end if;

  if p_client_mutation_id is not null then
    select * into v_result from library_loans
    where school_id = v_school_id and client_mutation_id = p_client_mutation_id;
    if found then
      return v_result;
    end if;
  end if;

  select su.id into v_issued_by from school_users su where su.auth_user_id = auth.uid();

  select available_copies into v_available from library_items where id = p_item_id and school_id = v_school_id for update;
  if v_available is null then
    raise exception 'library item not found in this school';
  end if;
  if v_available < 1 then
    raise exception 'no copies available for this item';
  end if;

  update library_items set available_copies = available_copies - 1, updated_at = now() where id = p_item_id;

  insert into library_loans (school_id, library_item_id, staff_id, issued_by, due_date, client_mutation_id)
  values (v_school_id, p_item_id, p_staff_id, v_issued_by, p_due_date, p_client_mutation_id)
  returning * into v_result;

  return v_result;
end;
$$;
