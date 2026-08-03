
alter table schools add column expense_approval_threshold numeric(10,2);
comment on column schools.expense_approval_threshold is 'Expenses at or below this amount self-approve when raised by a finance.write holder (blueprint 7.4: "approve above a configurable threshold"). Null means no threshold is set — every expense requires explicit Principal/Owner approval regardless of size, the safe default.';

create table expenses (
  id uuid primary key default gen_random_uuid(),
  school_id uuid not null references schools(id) on delete cascade,
  category text not null,
  vendor text not null,
  amount numeric(10,2) not null check (amount > 0),
  description text,
  receipt_url text,
  status text not null default 'pending' check (status in ('pending', 'approved', 'rejected')),
  requested_by uuid references school_users(id),
  approved_by uuid references school_users(id),
  approved_at timestamptz,
  created_at timestamptz not null default now()
);
comment on table expenses is 'Its own entity under Finance, separate from fee collection (blueprint 7.4). Bursar writes, Principal/Owner approve above schools.expense_approval_threshold — below it, a finance.write holder''s own submission self-approves.';

alter table expenses enable row level security;

create index expenses_school_id_idx on expenses (school_id);
create index expenses_status_idx on expenses (school_id, status);
create index expenses_requested_by_idx on expenses (requested_by);
create index expenses_approved_by_idx on expenses (approved_by);

insert into role_permissions (role_id, school_id, permission_key, allowed)
select r.id, null, 'expenses.approve', true from roles r where r.name in ('principal', 'school_owner');

create policy expenses_select on expenses for select
  using (school_id = auth_school_id() and auth_has_permission('finance.read'));
-- No direct write policy — only raise_expense()/approve_expense()/reject_expense() below.

create or replace function raise_expense(p_category text, p_vendor text, p_amount numeric, p_description text default null, p_receipt_url text default null) returns uuid
language plpgsql security definer set search_path = public as $$
declare
  v_school_id uuid := auth_school_id();
  v_requester uuid;
  v_threshold numeric;
  v_status text := 'pending';
  v_expense_id uuid;
begin
  if not auth_has_permission('finance.write') then
    raise exception 'Not authorized to raise expenses.';
  end if;

  select id into v_requester from school_users where auth_user_id = auth.uid();
  select expense_approval_threshold into v_threshold from schools where id = v_school_id;

  if auth_has_permission('expenses.approve') or (v_threshold is not null and p_amount <= v_threshold) then
    v_status := 'approved';
  end if;

  insert into expenses (school_id, category, vendor, amount, description, receipt_url, status, requested_by, approved_by, approved_at)
  values (v_school_id, p_category, p_vendor, p_amount, p_description, p_receipt_url, v_status, v_requester,
    case when v_status = 'approved' then v_requester else null end,
    case when v_status = 'approved' then now() else null end)
  returning id into v_expense_id;

  return v_expense_id;
end;
$$;

create or replace function approve_expense(p_expense_id uuid) returns void
language plpgsql security definer set search_path = public as $$
declare
  v_school_id uuid := auth_school_id();
  v_approver uuid;
begin
  if not auth_has_permission('expenses.approve') then
    raise exception 'Not authorized to approve expenses.';
  end if;
  if not exists (select 1 from expenses where id = p_expense_id and school_id = v_school_id and status = 'pending') then
    raise exception 'Expense not found or not pending.';
  end if;
  select id into v_approver from school_users where auth_user_id = auth.uid();
  update expenses set status = 'approved', approved_by = v_approver, approved_at = now() where id = p_expense_id;
end;
$$;

create or replace function reject_expense(p_expense_id uuid) returns void
language plpgsql security definer set search_path = public as $$
declare
  v_school_id uuid := auth_school_id();
  v_approver uuid;
begin
  if not auth_has_permission('expenses.approve') then
    raise exception 'Not authorized to reject expenses.';
  end if;
  if not exists (select 1 from expenses where id = p_expense_id and school_id = v_school_id and status = 'pending') then
    raise exception 'Expense not found or not pending.';
  end if;
  select id into v_approver from school_users where auth_user_id = auth.uid();
  update expenses set status = 'rejected', approved_by = v_approver, approved_at = now() where id = p_expense_id;
end;
$$;

revoke execute on function raise_expense(text, text, numeric, text, text) from public, anon;
revoke execute on function approve_expense(uuid) from public, anon;
revoke execute on function reject_expense(uuid) from public, anon;
grant execute on function raise_expense(text, text, numeric, text, text) to authenticated;
grant execute on function approve_expense(uuid) to authenticated;
grant execute on function reject_expense(uuid) to authenticated;
