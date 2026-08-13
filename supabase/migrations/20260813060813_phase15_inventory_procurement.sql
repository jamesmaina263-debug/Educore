-- ============================================================================
-- Phase 15 (2/6): Inventory & Procurement (Brief 4.9)
-- Stock (inventory_items/inventory_categories/inventory_stock_movements) already
-- exists and is REUSEd as-is. This adds the genuinely missing half: Assets
-- (distinct from consumables), Suppliers, Procurement (requisition -> PO ->
-- goods received -> supplier invoice), and Maintenance.
--
-- Deliberate separation of concerns per the brief: supplier_invoices tracks the
-- document/reference only (invoice number, date, amount) and points at an
-- optional expenses.id once Finance actually records the payment -- the
-- financial transaction itself stays owned by Finance's existing expenses
-- table, never duplicated here.
-- ============================================================================

insert into public.role_permissions (role_id, permission_key, allowed)
select r.id, 'inventory.procurement.approve', true
from public.roles r
where r.name in ('inventory_officer', 'principal', 'deputy_principal', 'school_owner')
  and not exists (select 1 from public.role_permissions rp where rp.role_id = r.id and rp.school_id is null and rp.permission_key = 'inventory.procurement.approve');

-- ============================================================================
-- Assets
-- ============================================================================
create table public.assets (
  id uuid primary key default gen_random_uuid(),
  school_id uuid not null references public.schools(id),
  name text not null,
  category text,
  asset_tag text,
  serial_number text,
  location text,
  assigned_to uuid references public.school_users(id),
  condition text not null default 'good' check (condition in ('excellent','good','fair','poor','damaged')),
  status text not null default 'in_use' check (status in ('in_use','in_storage','under_maintenance','disposed')),
  purchase_date date,
  purchase_value numeric(12,2),
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index assets_school_tag_idx on public.assets(school_id, asset_tag) where asset_tag is not null;
create index assets_status_idx on public.assets(school_id, status);

alter table public.assets enable row level security;

create policy assets_select on public.assets for select
  using (auth_is_super_admin() or (school_id = auth_school_id() and auth_has_permission('inventory.read_any')));

create policy assets_write on public.assets for all
  using (auth_is_super_admin() or (school_id = auth_school_id() and auth_has_permission('inventory.write')))
  with check (auth_is_super_admin() or (school_id = auth_school_id() and auth_has_permission('inventory.write')));

create trigger trg_audit_assets
  after insert or update or delete on public.assets
  for each row execute function public.audit_row_change();

-- ============================================================================
-- Asset Maintenance
-- ============================================================================
create table public.asset_maintenance_records (
  id uuid primary key default gen_random_uuid(),
  school_id uuid not null references public.schools(id),
  asset_id uuid not null references public.assets(id),
  request_date date not null default current_date,
  description text not null,
  status text not null default 'requested' check (status in ('requested','in_progress','completed','cancelled')),
  requested_by uuid references public.school_users(id),
  assigned_to uuid references public.school_users(id),
  completed_date date,
  cost numeric(12,2),
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index asset_maintenance_records_asset_id_idx on public.asset_maintenance_records(asset_id);

alter table public.asset_maintenance_records enable row level security;

create policy asset_maintenance_select on public.asset_maintenance_records for select
  using (auth_is_super_admin() or (school_id = auth_school_id() and auth_has_permission('inventory.read_any')));

create policy asset_maintenance_write on public.asset_maintenance_records for all
  using (auth_is_super_admin() or (school_id = auth_school_id() and auth_has_permission('inventory.write')))
  with check (auth_is_super_admin() or (school_id = auth_school_id() and auth_has_permission('inventory.write')));

create trigger trg_audit_asset_maintenance_records
  after insert or update or delete on public.asset_maintenance_records
  for each row execute function public.audit_row_change();

-- ============================================================================
-- Suppliers
-- ============================================================================
create table public.suppliers (
  id uuid primary key default gen_random_uuid(),
  school_id uuid not null references public.schools(id),
  name text not null,
  contact_person text,
  phone text,
  email text,
  address text,
  category text,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index suppliers_school_name_idx on public.suppliers(school_id, name);

alter table public.suppliers enable row level security;

create policy suppliers_select on public.suppliers for select
  using (auth_is_super_admin() or (school_id = auth_school_id() and auth_has_permission('inventory.read_any')));

create policy suppliers_write on public.suppliers for all
  using (auth_is_super_admin() or (school_id = auth_school_id() and auth_has_permission('inventory.write')))
  with check (auth_is_super_admin() or (school_id = auth_school_id() and auth_has_permission('inventory.write')));

create trigger trg_audit_suppliers
  after insert or update or delete on public.suppliers
  for each row execute function public.audit_row_change();

-- ============================================================================
-- Procurement: Requisition -> Purchase Order -> Goods Received -> Supplier Invoice
-- ============================================================================
create table public.purchase_requisitions (
  id uuid primary key default gen_random_uuid(),
  school_id uuid not null references public.schools(id),
  purpose text not null,
  status text not null default 'draft' check (status in ('draft','submitted','approved','rejected','converted')),
  requested_by uuid references public.school_users(id),
  approved_by uuid references public.school_users(id),
  approved_at timestamptz,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.purchase_requisitions enable row level security;

create policy purchase_requisitions_select on public.purchase_requisitions for select
  using (
    auth_is_super_admin() or (
      school_id = auth_school_id() and (
        auth_has_permission('inventory.read_any')
        or requested_by = auth_school_user_id()
      )
    )
  );

create policy purchase_requisitions_insert on public.purchase_requisitions for insert
  with check (auth_is_super_admin() or (school_id = auth_school_id() and auth_has_permission('inventory.write')));

create policy purchase_requisitions_update on public.purchase_requisitions for update
  using (
    auth_is_super_admin() or (
      school_id = auth_school_id() and (
        auth_has_permission('inventory.procurement.approve')
        or (requested_by = auth_school_user_id() and status = 'draft')
      )
    )
  )
  with check (
    auth_is_super_admin() or (
      school_id = auth_school_id() and (
        auth_has_permission('inventory.procurement.approve')
        or (requested_by = auth_school_user_id())
      )
    )
  );

create policy purchase_requisitions_delete on public.purchase_requisitions for delete
  using (auth_is_super_admin() or (school_id = auth_school_id() and auth_has_permission('inventory.procurement.approve')));

create trigger trg_audit_purchase_requisitions
  after insert or update or delete on public.purchase_requisitions
  for each row execute function public.audit_row_change();

create table public.purchase_requisition_items (
  id uuid primary key default gen_random_uuid(),
  requisition_id uuid not null references public.purchase_requisitions(id) on delete cascade,
  school_id uuid not null references public.schools(id),
  item_description text not null,
  quantity numeric(12,2) not null check (quantity > 0),
  estimated_unit_cost numeric(12,2),
  inventory_item_id uuid references public.inventory_items(id)
);

alter table public.purchase_requisition_items enable row level security;

create policy purchase_requisition_items_select on public.purchase_requisition_items for select
  using (
    auth_is_super_admin() or (
      school_id = auth_school_id() and (
        auth_has_permission('inventory.read_any')
        or exists (select 1 from public.purchase_requisitions r where r.id = purchase_requisition_items.requisition_id and r.requested_by = auth_school_user_id())
      )
    )
  );

create policy purchase_requisition_items_write on public.purchase_requisition_items for all
  using (auth_is_super_admin() or (school_id = auth_school_id() and auth_has_permission('inventory.write')))
  with check (auth_is_super_admin() or (school_id = auth_school_id() and auth_has_permission('inventory.write')));

create table public.purchase_orders (
  id uuid primary key default gen_random_uuid(),
  school_id uuid not null references public.schools(id),
  requisition_id uuid references public.purchase_requisitions(id),
  supplier_id uuid not null references public.suppliers(id),
  po_number text not null,
  status text not null default 'draft' check (status in ('draft','sent','partially_received','received','cancelled')),
  order_date date not null default current_date,
  expected_date date,
  created_by uuid references public.school_users(id),
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index purchase_orders_school_number_idx on public.purchase_orders(school_id, po_number);

alter table public.purchase_orders enable row level security;

create policy purchase_orders_select on public.purchase_orders for select
  using (auth_is_super_admin() or (school_id = auth_school_id() and auth_has_permission('inventory.read_any')));

create policy purchase_orders_insert on public.purchase_orders for insert
  with check (auth_is_super_admin() or (school_id = auth_school_id() and auth_has_permission('inventory.procurement.approve')));

create policy purchase_orders_update on public.purchase_orders for update
  using (auth_is_super_admin() or (school_id = auth_school_id() and auth_has_permission('inventory.procurement.approve')))
  with check (auth_is_super_admin() or (school_id = auth_school_id() and auth_has_permission('inventory.procurement.approve')));

create policy purchase_orders_delete on public.purchase_orders for delete
  using (auth_is_super_admin() or (school_id = auth_school_id() and auth_has_permission('inventory.procurement.approve')));

create trigger trg_audit_purchase_orders
  after insert or update or delete on public.purchase_orders
  for each row execute function public.audit_row_change();

create table public.purchase_order_items (
  id uuid primary key default gen_random_uuid(),
  po_id uuid not null references public.purchase_orders(id) on delete cascade,
  school_id uuid not null references public.schools(id),
  item_description text not null,
  quantity numeric(12,2) not null check (quantity > 0),
  unit_cost numeric(12,2) not null,
  inventory_item_id uuid references public.inventory_items(id),
  quantity_received numeric(12,2) not null default 0
);

alter table public.purchase_order_items enable row level security;

create policy purchase_order_items_select on public.purchase_order_items for select
  using (auth_is_super_admin() or (school_id = auth_school_id() and auth_has_permission('inventory.read_any')));

create policy purchase_order_items_write on public.purchase_order_items for all
  using (auth_is_super_admin() or (school_id = auth_school_id() and auth_has_permission('inventory.procurement.approve')))
  with check (auth_is_super_admin() or (school_id = auth_school_id() and auth_has_permission('inventory.procurement.approve')));

create table public.goods_received_notes (
  id uuid primary key default gen_random_uuid(),
  school_id uuid not null references public.schools(id),
  po_id uuid not null references public.purchase_orders(id),
  received_by uuid references public.school_users(id),
  received_date date not null default current_date,
  notes text,
  created_at timestamptz not null default now()
);

alter table public.goods_received_notes enable row level security;

create policy goods_received_notes_select on public.goods_received_notes for select
  using (auth_is_super_admin() or (school_id = auth_school_id() and auth_has_permission('inventory.read_any')));

create policy goods_received_notes_write on public.goods_received_notes for all
  using (auth_is_super_admin() or (school_id = auth_school_id() and auth_has_permission('inventory.write')))
  with check (auth_is_super_admin() or (school_id = auth_school_id() and auth_has_permission('inventory.write')));

create trigger trg_audit_goods_received_notes
  after insert or update or delete on public.goods_received_notes
  for each row execute function public.audit_row_change();

create table public.goods_received_items (
  id uuid primary key default gen_random_uuid(),
  grn_id uuid not null references public.goods_received_notes(id) on delete cascade,
  school_id uuid not null references public.schools(id),
  po_item_id uuid not null references public.purchase_order_items(id),
  quantity_received numeric(12,2) not null check (quantity_received > 0),
  condition_notes text
);

alter table public.goods_received_items enable row level security;

create policy goods_received_items_select on public.goods_received_items for select
  using (auth_is_super_admin() or (school_id = auth_school_id() and auth_has_permission('inventory.read_any')));

create policy goods_received_items_write on public.goods_received_items for all
  using (auth_is_super_admin() or (school_id = auth_school_id() and auth_has_permission('inventory.write')))
  with check (auth_is_super_admin() or (school_id = auth_school_id() and auth_has_permission('inventory.write')));

-- ============================================================================
-- Supplier Invoices -- document/reference tracking only. The financial
-- transaction itself lives in Finance's existing expenses table; expense_id
-- is populated once someone actually records the payment there.
-- ============================================================================
create table public.supplier_invoices (
  id uuid primary key default gen_random_uuid(),
  school_id uuid not null references public.schools(id),
  supplier_id uuid not null references public.suppliers(id),
  po_id uuid references public.purchase_orders(id),
  invoice_number text not null,
  invoice_date date not null,
  amount numeric(12,2) not null,
  status text not null default 'pending_payment' check (status in ('pending_payment','paid','cancelled')),
  expense_id uuid references public.expenses(id),
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index supplier_invoices_school_supplier_number_idx on public.supplier_invoices(school_id, supplier_id, invoice_number);

alter table public.supplier_invoices enable row level security;

create policy supplier_invoices_select on public.supplier_invoices for select
  using (auth_is_super_admin() or (school_id = auth_school_id() and (auth_has_permission('inventory.read_any') or auth_has_permission('finance.read'))));

create policy supplier_invoices_write on public.supplier_invoices for all
  using (auth_is_super_admin() or (school_id = auth_school_id() and (auth_has_permission('inventory.procurement.approve') or auth_has_permission('finance.write'))))
  with check (auth_is_super_admin() or (school_id = auth_school_id() and (auth_has_permission('inventory.procurement.approve') or auth_has_permission('finance.write'))));

create trigger trg_audit_supplier_invoices
  after insert or update or delete on public.supplier_invoices
  for each row execute function public.audit_row_change();
