-- Phase 8.5 (1/3): canteen / tuck-shop stores, database core. Additive only; ships dark.
--
-- Scope, in plain words: a price list and stock for the school canteen, sales to a student's prepaid wallet or for
-- cash, and the wallet itself. Everything here is RECORD-KEEPING:
--   * Wallet deposits and refunds are cash that a member of staff hands over or hands back; they are typed in.
--     There is NO M-Pesa / card / bank integration, no STK push, no C2B, and nothing here reads or writes
--     invoices, receipts, payments, fee balances or any other finance table. Online top-ups are a later,
--     separate decision.
--   * The wallet is the school's liability to families, held as an append-only ledger. The balance can never go
--     below zero (a table constraint, not just code) and always equals the sum of the ledger.
--   * Prices are read from the database at the moment of sale, never taken from the browser. A sale is
--     idempotent on a client reference, so a retried request cannot charge twice. Stock and wallet change in one
--     transaction under row locks.
--   * Voids and refunds need canteen.manage; selling needs canteen.sell. Voids reverse entries; nothing is deleted.
-- Same shape as the recent additive work packages: new flag (enabled for nobody), RLS select-only, every write
-- through SECURITY DEFINER functions that re-check the flag, nothing existing is edited.
-- Rollback: switch the flag off (reads return nothing, functions refuse). Nothing existing depends on these objects.

-- 1. Flag catalog entry.
insert into public.platform_feature_flags (key, label, description)
select 'feature.canteen.stores',
       'Canteen / tuck shop',
       'Canteen price list and stock, sales to a prepaid student wallet or for cash, wallet ledger, voids and refunds. Records only: no online payments. Off by default.'
where not exists (select 1 from public.platform_feature_flags where lower(key) = 'feature.canteen.stores');

-- 2. Permissions (platform defaults). Read: see everything. Sell: take sales, deposits and stock received.
--    Manage: prices, stock adjustments, voids, refunds. Schools can still override per role in Settings.
insert into public.role_permissions (role_id, permission_key, allowed)
select r.id, p.key, true
from public.roles r
join (values
  ('school_owner', 'canteen.read'), ('principal', 'canteen.read'), ('deputy_principal', 'canteen.read'), ('bursar', 'canteen.read'),
  ('school_owner', 'canteen.sell'), ('principal', 'canteen.sell'), ('bursar', 'canteen.sell'),
  ('school_owner', 'canteen.manage'), ('principal', 'canteen.manage'), ('bursar', 'canteen.manage')
) as p(role_name, key) on p.role_name = r.name
where not exists (
  select 1 from public.role_permissions x
  where x.role_id = r.id and x.permission_key = p.key and x.school_id is null
);

-- 3. Items and stock.
create table if not exists public.canteen_items (
  id uuid primary key default gen_random_uuid(),
  school_id uuid not null references public.schools(id) on delete cascade,
  name text not null check (char_length(btrim(name)) between 1 and 80),
  price numeric(10, 2) not null check (price > 0 and price <= 100000),
  stock_qty integer not null default 0 check (stock_qty >= 0),
  reorder_level integer not null default 0 check (reorder_level between 0 and 100000),
  active boolean not null default true,
  created_by uuid references public.school_users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
comment on table public.canteen_items is 'Canteen price list and stock on hand. Written only by save_canteen_item(), adjust_canteen_stock() and the sale/void functions.';
create unique index if not exists canteen_items_school_name_uniq on public.canteen_items (school_id, lower(btrim(name)));

create table if not exists public.canteen_stock_movements (
  id uuid primary key default gen_random_uuid(),
  school_id uuid not null references public.schools(id) on delete cascade,
  item_id uuid not null references public.canteen_items(id) on delete cascade,
  delta integer not null check (delta <> 0),
  reason text not null check (reason in ('received', 'adjustment', 'sale', 'void')),
  sale_id uuid,
  note text check (note is null or char_length(note) <= 200),
  created_by uuid references public.school_users(id) on delete set null,
  created_at timestamptz not null default now()
);
comment on table public.canteen_stock_movements is 'Append-only stock history.';
create index if not exists canteen_stock_movements_item on public.canteen_stock_movements (item_id, created_at);

-- 4. Sales.
create table if not exists public.canteen_sales (
  id uuid primary key default gen_random_uuid(),
  school_id uuid not null references public.schools(id) on delete cascade,
  student_id uuid references public.students(id) on delete cascade,
  tender text not null check (tender in ('wallet', 'cash')),
  total numeric(12, 2) not null check (total > 0 and total <= 50000),
  status text not null default 'completed' check (status in ('completed', 'voided')),
  client_ref text not null check (char_length(client_ref) between 1 and 64),
  sold_by uuid references public.school_users(id) on delete set null,
  voided_by uuid references public.school_users(id) on delete set null,
  voided_at timestamptz,
  void_reason text check (void_reason is null or char_length(void_reason) <= 200),
  created_at timestamptz not null default now(),
  constraint canteen_sales_wallet_needs_student check (tender <> 'wallet' or student_id is not null),
  constraint canteen_sales_void_shape check ((status = 'voided') = (voided_at is not null and void_reason is not null)),
  unique (school_id, client_ref)
);
comment on table public.canteen_sales is 'One row per sale. A void flips status; nothing is deleted. Written only by record_canteen_sale() / void_canteen_sale().';
create index if not exists canteen_sales_school_time on public.canteen_sales (school_id, created_at desc);
create index if not exists canteen_sales_student on public.canteen_sales (student_id, created_at desc);

create table if not exists public.canteen_sale_lines (
  id uuid primary key default gen_random_uuid(),
  school_id uuid not null references public.schools(id) on delete cascade,
  sale_id uuid not null references public.canteen_sales(id) on delete cascade,
  item_id uuid not null references public.canteen_items(id) on delete cascade,
  item_name text not null,
  unit_price numeric(10, 2) not null check (unit_price > 0),
  qty integer not null check (qty between 1 and 100),
  line_total numeric(12, 2) not null check (line_total > 0)
);
comment on table public.canteen_sale_lines is 'Item name and price are copied at the time of sale, so later price changes never alter history.';
create index if not exists canteen_sale_lines_sale on public.canteen_sale_lines (sale_id);

-- 5. Wallet and its ledger.
create table if not exists public.canteen_wallets (
  student_id uuid primary key references public.students(id) on delete cascade,
  school_id uuid not null references public.schools(id) on delete cascade,
  balance numeric(12, 2) not null default 0 check (balance >= 0),
  updated_at timestamptz not null default now()
);
comment on table public.canteen_wallets is 'Prepaid canteen balance. Never negative. Always equals the sum of canteen_wallet_entries. Not part of the fee ledger.';

create table if not exists public.canteen_wallet_entries (
  id uuid primary key default gen_random_uuid(),
  school_id uuid not null references public.schools(id) on delete cascade,
  student_id uuid not null references public.students(id) on delete cascade,
  kind text not null check (kind in ('deposit', 'sale', 'refund', 'void')),
  amount numeric(12, 2) not null check (amount <> 0),
  balance_after numeric(12, 2) not null check (balance_after >= 0),
  sale_id uuid references public.canteen_sales(id) on delete cascade,
  note text check (note is null or char_length(note) <= 200),
  client_ref text check (client_ref is null or char_length(client_ref) between 1 and 64),
  created_by uuid references public.school_users(id) on delete set null,
  created_at timestamptz not null default now(),
  constraint canteen_wallet_entries_sign check (
    (kind in ('deposit', 'void') and amount > 0) or (kind in ('sale', 'refund') and amount < 0)
  )
);
comment on table public.canteen_wallet_entries is 'Append-only wallet ledger. Deposits and voids add; sales and refunds subtract.';
create index if not exists canteen_wallet_entries_student on public.canteen_wallet_entries (student_id, created_at desc);
create unique index if not exists canteen_wallet_entries_ref_uniq on public.canteen_wallet_entries (school_id, client_ref) where client_ref is not null;

-- 6. History cannot be rewritten: ledger, stock history and sale lines refuse UPDATE and DELETE.
--    The only bypass is the existing owner-level school purge / trial reset switch.
create or replace function public.canteen_block_change()
returns trigger
language plpgsql
set search_path to 'public', 'pg_temp'
as $function$
begin
  if current_user not in ('anon', 'authenticated', 'authenticator', 'service_role')
     and coalesce(current_setting('educore.school_purge', true), '') = 'on' then
    if tg_op = 'DELETE' then return old; else return new; end if;
  end if;
  raise exception 'canteen history is append-only: % is not allowed', tg_op using errcode = '42501';
end;
$function$;
revoke all on function public.canteen_block_change() from public, anon, authenticated;

drop trigger if exists trg_canteen_wallet_entries_append_only on public.canteen_wallet_entries;
create trigger trg_canteen_wallet_entries_append_only before update or delete on public.canteen_wallet_entries
  for each row execute function public.canteen_block_change();
drop trigger if exists trg_canteen_stock_movements_append_only on public.canteen_stock_movements;
create trigger trg_canteen_stock_movements_append_only before update or delete on public.canteen_stock_movements
  for each row execute function public.canteen_block_change();
drop trigger if exists trg_canteen_sale_lines_append_only on public.canteen_sale_lines;
create trigger trg_canteen_sale_lines_append_only before update or delete on public.canteen_sale_lines
  for each row execute function public.canteen_block_change();

-- Who changed a price or switched an item off: the existing generic audit trigger (no personal data here).
drop trigger if exists trg_audit_canteen_items on public.canteen_items;
create trigger trg_audit_canteen_items after insert or update or delete on public.canteen_items
  for each row execute function public.audit_row_change();

-- 7. Row-level security: select only. Staff with canteen.read see their school's canteen. A guardian or the
--    student see their own wallet, ledger and purchases.
create or replace function public.canteen_can_see_student(p_school uuid, p_student uuid)
returns boolean
language sql
stable
security definer
set search_path to 'public'
as $$
  select p_school = auth_school_id()
    and public.my_school_has_feature_flag('feature.canteen.stores')
    and (
      auth_has_permission('canteen.read')
      or auth_user_id_is_guardian_of(p_student)
      or exists (
        select 1 from students st join school_users su on su.id = st.school_user_id
        where st.id = p_student and su.auth_user_id = auth.uid() and su.status = 'active'
      )
    );
$$;
revoke all on function public.canteen_can_see_student(uuid, uuid) from public, anon;
grant execute on function public.canteen_can_see_student(uuid, uuid) to authenticated;

create or replace function public.canteen_staff_can_read(p_school uuid)
returns boolean
language sql
stable
security definer
set search_path to 'public'
as $$
  select p_school = auth_school_id()
    and public.my_school_has_feature_flag('feature.canteen.stores')
    and auth_has_permission('canteen.read');
$$;
revoke all on function public.canteen_staff_can_read(uuid) from public, anon;
grant execute on function public.canteen_staff_can_read(uuid) to authenticated;

alter table public.canteen_items enable row level security;
alter table public.canteen_stock_movements enable row level security;
alter table public.canteen_sales enable row level security;
alter table public.canteen_sale_lines enable row level security;
alter table public.canteen_wallets enable row level security;
alter table public.canteen_wallet_entries enable row level security;

drop policy if exists canteen_items_select on public.canteen_items;
create policy canteen_items_select on public.canteen_items for select
  using (public.canteen_staff_can_read(school_id));
drop policy if exists canteen_stock_movements_select on public.canteen_stock_movements;
create policy canteen_stock_movements_select on public.canteen_stock_movements for select
  using (public.canteen_staff_can_read(school_id));
drop policy if exists canteen_sales_select on public.canteen_sales;
create policy canteen_sales_select on public.canteen_sales for select
  using (public.canteen_staff_can_read(school_id) or (student_id is not null and public.canteen_can_see_student(school_id, student_id)));
drop policy if exists canteen_sale_lines_select on public.canteen_sale_lines;
create policy canteen_sale_lines_select on public.canteen_sale_lines for select
  using (exists (select 1 from public.canteen_sales s where s.id = canteen_sale_lines.sale_id));
drop policy if exists canteen_wallets_select on public.canteen_wallets;
create policy canteen_wallets_select on public.canteen_wallets for select
  using (public.canteen_can_see_student(school_id, student_id));
drop policy if exists canteen_wallet_entries_select on public.canteen_wallet_entries;
create policy canteen_wallet_entries_select on public.canteen_wallet_entries for select
  using (public.canteen_can_see_student(school_id, student_id));

-- 8. Shared guard: right permission in the caller's own school, flag on. Returns the school id.
create or replace function public.canteen_guard(p_permission text)
returns uuid
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_school uuid := auth_school_id();
begin
  if v_school is null or not auth_has_permission(p_permission) then
    raise exception 'Not authorized for this canteen action.' using errcode = '42501';
  end if;
  if not public.school_has_feature_flag(v_school, 'feature.canteen.stores') then
    raise exception 'The canteen is not enabled for this school.' using errcode = '55000';
  end if;
  return v_school;
end;
$$;
revoke all on function public.canteen_guard(text) from public, anon, authenticated;

create or replace function public.canteen_actor(p_school uuid)
returns uuid
language sql
stable
security definer
set search_path to 'public'
as $$
  select id from public.school_users
   where auth_user_id = auth.uid() and school_id = p_school and status = 'active' limit 1;
$$;
revoke all on function public.canteen_actor(uuid) from public, anon, authenticated;

-- 9. Items: create or change (manage). Price changes never alter past sales.
create or replace function public.save_canteen_item(
  p_id uuid, p_name text, p_price numeric, p_reorder_level integer, p_active boolean
) returns uuid
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_school uuid := public.canteen_guard('canteen.manage');
  v_id uuid;
begin
  if p_name is null or char_length(btrim(p_name)) not between 1 and 80
     or p_price is null or p_price <= 0 or p_price > 100000 or p_price <> round(p_price, 2)
     or p_reorder_level is null or p_reorder_level not between 0 and 100000
     or p_active is null then
    raise exception 'Invalid item details.' using errcode = '22023';
  end if;
  begin
    if p_id is null then
      insert into public.canteen_items (school_id, name, price, reorder_level, active, created_by)
      values (v_school, btrim(p_name), p_price, p_reorder_level, p_active, public.canteen_actor(v_school))
      returning id into v_id;
    else
      update public.canteen_items
         set name = btrim(p_name), price = p_price, reorder_level = p_reorder_level, active = p_active, updated_at = now()
       where id = p_id and school_id = v_school
      returning id into v_id;
      if v_id is null then
        raise exception 'Item not found.' using errcode = 'P0002';
      end if;
    end if;
  exception when unique_violation then
    raise exception 'An item with that name already exists.' using errcode = '23505';
  end;
  return v_id;
end;
$$;
revoke all on function public.save_canteen_item(uuid, text, numeric, integer, boolean) from public, anon;
grant execute on function public.save_canteen_item(uuid, text, numeric, integer, boolean) to authenticated;

-- 10. Stock: "received" (sell) or "adjustment" (manage; needs a note). Stock can never go below zero.
create or replace function public.adjust_canteen_stock(
  p_item_id uuid, p_delta integer, p_reason text, p_note text
) returns integer
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_school uuid := public.canteen_guard('canteen.sell');
  v_stock integer;
begin
  if p_reason is null or p_reason not in ('received', 'adjustment')
     or p_delta is null or p_delta = 0 or abs(p_delta) > 100000
     or (p_note is not null and char_length(p_note) > 200) then
    raise exception 'Invalid stock change.' using errcode = '22023';
  end if;
  if p_reason = 'received' and p_delta < 0 then
    raise exception 'Stock received must be a positive number.' using errcode = '22023';
  end if;
  if p_reason = 'adjustment' then
    if not auth_has_permission('canteen.manage') then
      raise exception 'Only a canteen manager can adjust stock.' using errcode = '42501';
    end if;
    if nullif(btrim(p_note), '') is null then
      raise exception 'Say why the stock is being adjusted.' using errcode = '22023';
    end if;
  end if;

  select stock_qty into v_stock from public.canteen_items where id = p_item_id and school_id = v_school for update;
  if not found then
    raise exception 'Item not found.' using errcode = 'P0002';
  end if;
  if v_stock + p_delta < 0 then
    raise exception 'Stock cannot go below zero (on hand: %).', v_stock using errcode = '22023';
  end if;
  update public.canteen_items set stock_qty = v_stock + p_delta, updated_at = now() where id = p_item_id;
  insert into public.canteen_stock_movements (school_id, item_id, delta, reason, note, created_by)
  values (v_school, p_item_id, p_delta, p_reason, nullif(btrim(p_note), ''), public.canteen_actor(v_school));
  return v_stock + p_delta;
end;
$$;
revoke all on function public.adjust_canteen_stock(uuid, integer, text, text) from public, anon;
grant execute on function public.adjust_canteen_stock(uuid, integer, text, text) to authenticated;

-- 11. Deposit: cash a member of staff received for a student's wallet. Idempotent on p_client_ref.
create or replace function public.record_canteen_deposit(
  p_student_id uuid, p_amount numeric, p_note text, p_client_ref text
) returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_school uuid := public.canteen_guard('canteen.sell');
  v_status text;
  v_bal numeric(12, 2);
  v_existing record;
begin
  if p_amount is null or p_amount <= 0 or p_amount > 50000 or p_amount <> round(p_amount, 2)
     or p_client_ref is null or char_length(p_client_ref) not between 1 and 64
     or (p_note is not null and char_length(p_note) > 200) then
    raise exception 'Invalid deposit.' using errcode = '22023';
  end if;
  perform pg_advisory_xact_lock(hashtextextended(v_school::text || ':dep:' || p_client_ref, 0));
  select student_id, amount, balance_after into v_existing
    from public.canteen_wallet_entries where school_id = v_school and client_ref = p_client_ref;
  if found then
    return jsonb_build_object('balance', v_existing.balance_after, 'amount', v_existing.amount, 'duplicate', true);
  end if;

  select status into v_status from public.students where id = p_student_id and school_id = v_school;
  if not found then
    raise exception 'Student not found.' using errcode = 'P0002';
  end if;
  if v_status not in ('enrolled', 'active') then
    raise exception 'Only enrolled students can have money added.' using errcode = '22023';
  end if;

  insert into public.canteen_wallets (student_id, school_id) values (p_student_id, v_school) on conflict (student_id) do nothing;
  select balance into v_bal from public.canteen_wallets where student_id = p_student_id for update;
  v_bal := v_bal + p_amount;
  update public.canteen_wallets set balance = v_bal, updated_at = now() where student_id = p_student_id;
  insert into public.canteen_wallet_entries (school_id, student_id, kind, amount, balance_after, note, client_ref, created_by)
  values (v_school, p_student_id, 'deposit', p_amount, v_bal, nullif(btrim(p_note), ''), p_client_ref, public.canteen_actor(v_school));
  return jsonb_build_object('balance', v_bal, 'amount', p_amount, 'duplicate', false);
end;
$$;
revoke all on function public.record_canteen_deposit(uuid, numeric, text, text) from public, anon;
grant execute on function public.record_canteen_deposit(uuid, numeric, text, text) to authenticated;

-- 12. Refund: cash handed back from a student's wallet (for example when they leave). Manage only; reason needed.
create or replace function public.record_canteen_refund(
  p_student_id uuid, p_amount numeric, p_note text, p_client_ref text
) returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_school uuid := public.canteen_guard('canteen.manage');
  v_bal numeric(12, 2);
  v_existing record;
begin
  if p_amount is null or p_amount <= 0 or p_amount > 50000 or p_amount <> round(p_amount, 2)
     or p_client_ref is null or char_length(p_client_ref) not between 1 and 64
     or (p_note is not null and char_length(p_note) > 200) then
    raise exception 'Invalid refund.' using errcode = '22023';
  end if;
  if nullif(btrim(p_note), '') is null then
    raise exception 'Say why this money is being paid out.' using errcode = '22023';
  end if;
  perform pg_advisory_xact_lock(hashtextextended(v_school::text || ':ref:' || p_client_ref, 0));
  select amount, balance_after into v_existing
    from public.canteen_wallet_entries where school_id = v_school and client_ref = p_client_ref;
  if found then
    return jsonb_build_object('balance', v_existing.balance_after, 'amount', -v_existing.amount, 'duplicate', true);
  end if;

  if not exists (select 1 from public.students where id = p_student_id and school_id = v_school) then
    raise exception 'Student not found.' using errcode = 'P0002';
  end if;
  select balance into v_bal from public.canteen_wallets where student_id = p_student_id and school_id = v_school for update;
  if not found or v_bal < p_amount then
    raise exception 'That is more than the wallet holds (balance: %).', coalesce(v_bal, 0) using errcode = '22023';
  end if;
  v_bal := v_bal - p_amount;
  update public.canteen_wallets set balance = v_bal, updated_at = now() where student_id = p_student_id;
  insert into public.canteen_wallet_entries (school_id, student_id, kind, amount, balance_after, note, client_ref, created_by)
  values (v_school, p_student_id, 'refund', -p_amount, v_bal, btrim(p_note), p_client_ref, public.canteen_actor(v_school));
  return jsonb_build_object('balance', v_bal, 'amount', p_amount, 'duplicate', false);
end;
$$;
revoke all on function public.record_canteen_refund(uuid, numeric, text, text) from public, anon;
grant execute on function public.record_canteen_refund(uuid, numeric, text, text) to authenticated;

-- 13. Sale. p_lines is [{"item_id": uuid, "qty": 1..100}, ...] (up to 40 lines). Prices come from the database.
create or replace function public.record_canteen_sale(
  p_student_id uuid, p_tender text, p_lines jsonb, p_client_ref text
) returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_school uuid := public.canteen_guard('canteen.sell');
  v_actor uuid := null;
  v_total numeric(12, 2) := 0;
  v_sale uuid;
  v_existing record;
  v_status text;
  v_bal numeric(12, 2);
  v_new_bal numeric(12, 2);
  v_expected integer;
  v_found integer := 0;
  e jsonb;
  r record;
begin
  v_actor := public.canteen_actor(v_school);
  if p_tender is null or p_tender not in ('wallet', 'cash')
     or p_client_ref is null or char_length(p_client_ref) not between 1 and 64
     or p_lines is null or jsonb_typeof(p_lines) <> 'array' or jsonb_array_length(p_lines) not between 1 and 40 then
    raise exception 'Invalid sale.' using errcode = '22023';
  end if;
  for e in select * from jsonb_array_elements(p_lines) loop
    if jsonb_typeof(e) <> 'object'
       or (e ->> 'item_id') is null or (e ->> 'item_id') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
       or jsonb_typeof(e -> 'qty') is distinct from 'number' or (e ->> 'qty') !~ '^[0-9]+$'
       or (e ->> 'qty')::int not between 1 and 100 then
      raise exception 'Each line needs an item and a quantity from 1 to 100.' using errcode = '22023';
    end if;
  end loop;

  perform pg_advisory_xact_lock(hashtextextended(v_school::text || ':sale:' || p_client_ref, 0));
  select id, student_id, tender, total, status into v_existing
    from public.canteen_sales where school_id = v_school and client_ref = p_client_ref;
  if found then
    return jsonb_build_object(
      'sale_id', v_existing.id, 'total', v_existing.total, 'tender', v_existing.tender, 'duplicate', true,
      'balance', (select balance from public.canteen_wallets where student_id = v_existing.student_id));
  end if;

  if p_student_id is not null then
    select status into v_status from public.students where id = p_student_id and school_id = v_school;
    if not found then
      raise exception 'Student not found.' using errcode = 'P0002';
    end if;
    if v_status not in ('enrolled', 'active') then
      raise exception 'Only enrolled students can buy from the canteen.' using errcode = '22023';
    end if;
  elsif p_tender = 'wallet' then
    raise exception 'A wallet sale needs a student.' using errcode = '22023';
  end if;

  select count(distinct (x ->> 'item_id')) into v_expected from jsonb_array_elements(p_lines) x;

  -- Pass 1: lock the items (in id order, so two tills never deadlock), check stock, add up the total.
  for r in
    select i.id, i.name, i.price, i.stock_qty, i.active, a.qty
      from (select (x ->> 'item_id')::uuid as item_id, sum((x ->> 'qty')::int)::int as qty
              from jsonb_array_elements(p_lines) x group by 1) a
      join public.canteen_items i on i.id = a.item_id and i.school_id = v_school
     order by i.id
       for update of i
  loop
    v_found := v_found + 1;
    if not r.active then
      raise exception '% is not on sale.', r.name using errcode = '22023';
    end if;
    if r.stock_qty < r.qty then
      raise exception 'Not enough % in stock (on hand: %).', r.name, r.stock_qty using errcode = '22023';
    end if;
    v_total := v_total + r.price * r.qty;
  end loop;
  if v_found <> v_expected then
    raise exception 'Item not found.' using errcode = 'P0002';
  end if;
  if v_total <= 0 or v_total > 50000 then
    raise exception 'A sale must be between KES 0.01 and KES 50,000.' using errcode = '22023';
  end if;

  if p_tender = 'wallet' then
    insert into public.canteen_wallets (student_id, school_id) values (p_student_id, v_school) on conflict (student_id) do nothing;
    select balance into v_bal from public.canteen_wallets where student_id = p_student_id for update;
    if v_bal < v_total then
      raise exception 'Not enough in the wallet. Balance is KES %, the total is KES %.', v_bal, v_total using errcode = '22023';
    end if;
  end if;

  insert into public.canteen_sales (school_id, student_id, tender, total, client_ref, sold_by)
  values (v_school, p_student_id, p_tender, v_total, p_client_ref, v_actor)
  returning id into v_sale;

  -- Pass 2 (rows are still locked): lines, stock, movements.
  for r in
    select i.id, i.name, i.price, a.qty
      from (select (x ->> 'item_id')::uuid as item_id, sum((x ->> 'qty')::int)::int as qty
              from jsonb_array_elements(p_lines) x group by 1) a
      join public.canteen_items i on i.id = a.item_id and i.school_id = v_school
     order by i.id
  loop
    insert into public.canteen_sale_lines (school_id, sale_id, item_id, item_name, unit_price, qty, line_total)
    values (v_school, v_sale, r.id, r.name, r.price, r.qty, r.price * r.qty);
    update public.canteen_items set stock_qty = stock_qty - r.qty, updated_at = now() where id = r.id;
    insert into public.canteen_stock_movements (school_id, item_id, delta, reason, sale_id, created_by)
    values (v_school, r.id, -r.qty, 'sale', v_sale, v_actor);
  end loop;

  if p_tender = 'wallet' then
    v_new_bal := v_bal - v_total;
    update public.canteen_wallets set balance = v_new_bal, updated_at = now() where student_id = p_student_id;
    insert into public.canteen_wallet_entries (school_id, student_id, kind, amount, balance_after, sale_id, created_by)
    values (v_school, p_student_id, 'sale', -v_total, v_new_bal, v_sale, v_actor);
  end if;

  return jsonb_build_object('sale_id', v_sale, 'total', v_total, 'tender', p_tender, 'duplicate', false, 'balance', v_new_bal);
end;
$$;
revoke all on function public.record_canteen_sale(uuid, text, jsonb, text) from public, anon;
grant execute on function public.record_canteen_sale(uuid, text, jsonb, text) to authenticated;

-- 14. Void a sale (manage; reason needed). Puts the stock back and, for a wallet sale, the money back.
create or replace function public.void_canteen_sale(p_sale_id uuid, p_reason text)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_school uuid := public.canteen_guard('canteen.manage');
  v_actor uuid;
  v_sale record;
  v_bal numeric(12, 2);
  r record;
begin
  if p_reason is null or char_length(btrim(p_reason)) not between 3 and 200 then
    raise exception 'Give a reason for the void (3 to 200 characters).' using errcode = '22023';
  end if;
  v_actor := public.canteen_actor(v_school);
  select id, student_id, tender, total, status into v_sale
    from public.canteen_sales where id = p_sale_id and school_id = v_school for update;
  if not found then
    raise exception 'Sale not found.' using errcode = 'P0002';
  end if;
  if v_sale.status <> 'completed' then
    raise exception 'This sale has already been voided.' using errcode = '22023';
  end if;

  for r in
    select l.item_id, l.qty from public.canteen_sale_lines l where l.sale_id = p_sale_id order by l.item_id
  loop
    perform 1 from public.canteen_items where id = r.item_id for update;
    update public.canteen_items set stock_qty = stock_qty + r.qty, updated_at = now() where id = r.item_id;
    insert into public.canteen_stock_movements (school_id, item_id, delta, reason, sale_id, note, created_by)
    values (v_school, r.item_id, r.qty, 'void', p_sale_id, 'Sale voided', v_actor);
  end loop;

  if v_sale.tender = 'wallet' then
    select balance into v_bal from public.canteen_wallets where student_id = v_sale.student_id for update;
    v_bal := v_bal + v_sale.total;
    update public.canteen_wallets set balance = v_bal, updated_at = now() where student_id = v_sale.student_id;
    insert into public.canteen_wallet_entries (school_id, student_id, kind, amount, balance_after, sale_id, note, created_by)
    values (v_school, v_sale.student_id, 'void', v_sale.total, v_bal, p_sale_id, 'Sale voided', v_actor);
  end if;

  update public.canteen_sales
     set status = 'voided', voided_by = v_actor, voided_at = now(), void_reason = btrim(p_reason)
   where id = p_sale_id;
  return jsonb_build_object('sale_id', p_sale_id, 'refunded_to_wallet', v_sale.tender = 'wallet', 'balance', v_bal);
end;
$$;
revoke all on function public.void_canteen_sale(uuid, text) from public, anon;
grant execute on function public.void_canteen_sale(uuid, text) to authenticated;

-- 15. Summary for a date range (Nairobi days, at most 92). Read only.
create or replace function public.canteen_summary(p_from date, p_to date)
returns jsonb
language plpgsql
stable
security definer
set search_path to 'public'
as $$
declare
  v_school uuid := public.canteen_guard('canteen.read');
  v_start timestamptz;
  v_end timestamptz;
  v_out jsonb;
begin
  if p_from is null or p_to is null or p_to < p_from or p_to - p_from > 92 then
    raise exception 'Choose a date range of at most 92 days.' using errcode = '22023';
  end if;
  v_start := (p_from::timestamp) at time zone 'Africa/Nairobi';
  v_end := ((p_to + 1)::timestamp) at time zone 'Africa/Nairobi';
  select jsonb_build_object(
    'sales_count', count(*) filter (where status = 'completed'),
    'wallet_sales', coalesce(sum(total) filter (where status = 'completed' and tender = 'wallet'), 0),
    'cash_sales', coalesce(sum(total) filter (where status = 'completed' and tender = 'cash'), 0),
    'voided_count', count(*) filter (where status = 'voided'),
    'voided_total', coalesce(sum(total) filter (where status = 'voided'), 0)
  ) into v_out
  from public.canteen_sales where school_id = v_school and created_at >= v_start and created_at < v_end;

  return v_out || jsonb_build_object(
    'deposits', coalesce((select sum(amount) from public.canteen_wallet_entries
                           where school_id = v_school and kind = 'deposit' and created_at >= v_start and created_at < v_end), 0),
    'refunds', coalesce((select -sum(amount) from public.canteen_wallet_entries
                          where school_id = v_school and kind = 'refund' and created_at >= v_start and created_at < v_end), 0),
    'wallet_liability', coalesce((select sum(balance) from public.canteen_wallets where school_id = v_school), 0),
    'low_stock', coalesce((select jsonb_agg(jsonb_build_object('id', id, 'name', name, 'stock', stock_qty, 'reorder_level', reorder_level) order by name)
                            from public.canteen_items where school_id = v_school and active and stock_qty <= reorder_level), '[]'::jsonb)
  );
end;
$$;
revoke all on function public.canteen_summary(date, date) from public, anon;
grant execute on function public.canteen_summary(date, date) to authenticated;
