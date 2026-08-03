
create table discounts (
  id uuid primary key default gen_random_uuid(),
  school_id uuid not null references schools(id) on delete cascade,
  student_id uuid not null references students(id) on delete cascade,
  invoice_id uuid not null references invoices(id) on delete cascade,
  amount numeric(10,2) not null check (amount > 0),
  reason text not null,
  status text not null default 'pending' check (status in ('pending', 'approved', 'rejected')),
  requested_by uuid references school_users(id),
  approved_by uuid references school_users(id),
  approved_at timestamptz,
  created_at timestamptz not null default now()
);
comment on table discounts is 'A discount/waiver requires approved_by (Principal/Owner) before it reduces a balance — blueprint Part D: a bursar cannot unilaterally discount a fee. Only approved discounts count in recompute_invoice_status(); pending/rejected ones never touch a balance.';

alter table discounts enable row level security;

create index discounts_school_id_idx on discounts (school_id);
create index discounts_student_id_idx on discounts (student_id);
create index discounts_invoice_id_idx on discounts (invoice_id);
create index discounts_requested_by_idx on discounts (requested_by);
create index discounts_approved_by_idx on discounts (approved_by);

insert into role_permissions (role_id, school_id, permission_key, allowed)
select r.id, null, 'discounts.approve', true from roles r where r.name in ('principal', 'school_owner');

create policy discounts_select_staff on discounts for select
  using (school_id = auth_school_id() and auth_has_permission('finance.read'));
create policy discounts_select_guardian on discounts for select
  using (auth_user_id_is_guardian_of(discounts.student_id));
create policy discounts_select_self on discounts for select
  using (exists (select 1 from students st join school_users su on su.id = st.school_user_id where st.id = discounts.student_id and su.auth_user_id = auth.uid()));
-- No direct write policy — only request_discount()/approve_discount()/reject_discount() below.

create or replace function request_discount(p_student_id uuid, p_invoice_id uuid, p_amount numeric, p_reason text) returns uuid
language plpgsql security definer set search_path = public as $$
declare
  v_school_id uuid := auth_school_id();
  v_requested_by uuid;
  v_discount_id uuid;
begin
  if not auth_has_permission('finance.write') then
    raise exception 'Not authorized to request discounts.';
  end if;
  if not exists (select 1 from invoices where id = p_invoice_id and student_id = p_student_id and school_id = v_school_id) then
    raise exception 'Invoice does not belong to this student.';
  end if;

  select id into v_requested_by from school_users where auth_user_id = auth.uid();

  insert into discounts (school_id, student_id, invoice_id, amount, reason, requested_by)
  values (v_school_id, p_student_id, p_invoice_id, p_amount, p_reason, v_requested_by)
  returning id into v_discount_id;

  return v_discount_id;
end;
$$;

create or replace function approve_discount(p_discount_id uuid) returns void
language plpgsql security definer set search_path = public as $$
declare
  v_school_id uuid := auth_school_id();
  v_invoice_id uuid;
  v_approver uuid;
begin
  if not auth_has_permission('discounts.approve') then
    raise exception 'Not authorized to approve discounts.';
  end if;
  select invoice_id into v_invoice_id from discounts where id = p_discount_id and school_id = v_school_id and status = 'pending';
  if v_invoice_id is null then
    raise exception 'Discount not found or not pending.';
  end if;

  select id into v_approver from school_users where auth_user_id = auth.uid();
  update discounts set status = 'approved', approved_by = v_approver, approved_at = now() where id = p_discount_id;

  perform recompute_invoice_status(v_invoice_id);
end;
$$;

create or replace function reject_discount(p_discount_id uuid) returns void
language plpgsql security definer set search_path = public as $$
declare
  v_school_id uuid := auth_school_id();
  v_approver uuid;
begin
  if not auth_has_permission('discounts.approve') then
    raise exception 'Not authorized to reject discounts.';
  end if;
  if not exists (select 1 from discounts where id = p_discount_id and school_id = v_school_id and status = 'pending') then
    raise exception 'Discount not found or not pending.';
  end if;

  select id into v_approver from school_users where auth_user_id = auth.uid();
  update discounts set status = 'rejected', approved_by = v_approver, approved_at = now() where id = p_discount_id;
end;
$$;

revoke execute on function request_discount(uuid, uuid, numeric, text) from public, anon;
revoke execute on function approve_discount(uuid) from public, anon;
revoke execute on function reject_discount(uuid) from public, anon;
grant execute on function request_discount(uuid, uuid, numeric, text) to authenticated;
grant execute on function approve_discount(uuid) to authenticated;
grant execute on function reject_discount(uuid) to authenticated;
