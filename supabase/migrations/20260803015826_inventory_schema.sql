-- Inventory: general school asset/consumable stock tracking (desks, lab equipment,
-- textbooks not in circulation) — distinct from Library (loan-tracking of catalogued
-- books) and distinct from Finance/Expenses (money, not stock).
--
-- NOTE: the blueprint's §8 roles matrix has no Inventory column (a real gap in the
-- source document, not an oversight here). Judgment call, documented: Owner/Principal
-- full (matches every other module's top rung); Deputy read (matches their general
-- read-oversight pattern elsewhere); Bursar full/write — no dedicated "Inventory
-- Manager" role exists among the 12, and Bursar already writes Expenses (the closest
-- precedent in the blueprint), and in practice a Kenyan school's bursar commonly
-- doubles as stores/procurement officer. Teacher/Class Teacher/Hostel Warden/
-- Librarian/Transport Manager/Parent/Student: none — this isn't tied to an
-- individual student the way loans/allocations are, so no self-read case exists.

create table public.inventory_categories (
  id uuid primary key default gen_random_uuid(),
  school_id uuid not null references public.schools(id),
  name text not null,
  created_at timestamptz not null default now(),
  unique (school_id, name)
);

create table public.inventory_items (
  id uuid primary key default gen_random_uuid(),
  school_id uuid not null references public.schools(id),
  category_id uuid references public.inventory_categories(id),
  name text not null,
  description text,
  unit text not null default 'pieces',
  quantity int not null default 0 check (quantity >= 0),
  reorder_level int check (reorder_level >= 0),
  location text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.inventory_stock_movements (
  id uuid primary key default gen_random_uuid(),
  school_id uuid not null references public.schools(id),
  item_id uuid not null references public.inventory_items(id),
  movement_type text not null check (movement_type in ('in','out')),
  quantity int not null check (quantity > 0),
  reason text,
  actor uuid references public.school_users(id),
  moved_at timestamptz not null default now()
);

alter table public.inventory_categories enable row level security;
alter table public.inventory_items enable row level security;
alter table public.inventory_stock_movements enable row level security;

create policy inventory_categories_select on public.inventory_categories
  for select using (auth_is_super_admin() or (school_id = auth_school_id() and auth_has_permission('inventory.read_any')));
create policy inventory_categories_insert on public.inventory_categories
  for insert with check (auth_is_super_admin() or (school_id = auth_school_id() and auth_has_permission('inventory.write')));
create policy inventory_categories_update on public.inventory_categories
  for update using (auth_is_super_admin() or (school_id = auth_school_id() and auth_has_permission('inventory.write')));

create policy inventory_items_select on public.inventory_items
  for select using (auth_is_super_admin() or (school_id = auth_school_id() and auth_has_permission('inventory.read_any')));
create policy inventory_items_insert on public.inventory_items
  for insert with check (auth_is_super_admin() or (school_id = auth_school_id() and auth_has_permission('inventory.write')));
create policy inventory_items_update on public.inventory_items
  for update using (auth_is_super_admin() or (school_id = auth_school_id() and auth_has_permission('inventory.write')));

create policy inventory_stock_movements_select on public.inventory_stock_movements
  for select using (auth_is_super_admin() or (school_id = auth_school_id() and auth_has_permission('inventory.read_any')));
create policy inventory_stock_movements_insert on public.inventory_stock_movements
  for insert with check (auth_is_super_admin() or (school_id = auth_school_id() and auth_has_permission('inventory.write')));

revoke all on public.inventory_categories, public.inventory_items, public.inventory_stock_movements from public, anon;
grant select, insert, update on public.inventory_categories, public.inventory_items to authenticated;
grant select, insert on public.inventory_stock_movements to authenticated;
