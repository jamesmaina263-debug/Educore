
create table payments (
  id uuid primary key default gen_random_uuid(),
  school_id uuid not null references schools(id) on delete cascade,
  student_id uuid not null references students(id) on delete cascade,
  method text not null check (method in ('mpesa', 'cash', 'bank', 'cheque')),
  amount numeric(10,2) not null check (amount > 0),
  reference text, -- M-Pesa receipt number / cheque number / bank transaction ref
  phone_number text,
  -- Reserved for when live M-Pesa Daraja STK-push is wired (needs the school's own Paybill/Till
  -- credentials, which this session doesn't have — see migration comment below). The blueprint is
  -- explicit that M-Pesa callbacks retry and must be idempotent, so this column and its uniqueness
  -- constraint are added now even though every payment today is manually recorded by a bursar, to
  -- avoid a breaking migration when STK push automation arrives.
  mpesa_checkout_request_id text,
  recorded_by uuid references school_users(id),
  recorded_at timestamptz not null default now(),
  created_at timestamptz not null default now()
);
comment on table payments is 'Every payment recorded today is manual bursar entry (M-Pesa reference typed in after an SMS confirmation, or cash/bank/cheque) — live Daraja STK-push automation needs the school''s own Paybill/Till credentials and is not built yet.';

create unique index payments_mpesa_checkout_request_id_idx on payments (mpesa_checkout_request_id) where mpesa_checkout_request_id is not null;

create table payment_allocations (
  id uuid primary key default gen_random_uuid(),
  payment_id uuid not null references payments(id) on delete cascade,
  invoice_id uuid not null references invoices(id) on delete cascade,
  amount_allocated numeric(10,2) not null check (amount_allocated > 0),
  created_at timestamptz not null default now(),
  unique (payment_id, invoice_id)
);

alter table payments enable row level security;
alter table payment_allocations enable row level security;

create index payments_school_id_created_at_idx on payments (school_id, created_at);
create index payments_student_id_idx on payments (student_id);
create index payments_recorded_by_idx on payments (recorded_by);
create index payment_allocations_payment_id_idx on payment_allocations (payment_id);
create index payment_allocations_invoice_id_idx on payment_allocations (invoice_id);

create policy payments_select_staff on payments for select
  using (school_id = auth_school_id() and auth_has_permission('finance.read'));
create policy payments_select_guardian on payments for select
  using (auth_user_id_is_guardian_of(payments.student_id));
create policy payments_select_self on payments for select
  using (exists (select 1 from students st join school_users su on su.id = st.school_user_id where st.id = payments.student_id and su.auth_user_id = auth.uid()));
-- No direct write policy — payments and their allocations are only ever created via record_payment().

create policy payment_allocations_select_staff on payment_allocations for select
  using (exists (select 1 from payments p where p.id = payment_allocations.payment_id and p.school_id = auth_school_id() and auth_has_permission('finance.read')));
create policy payment_allocations_select_guardian on payment_allocations for select
  using (exists (select 1 from payments p where p.id = payment_allocations.payment_id and auth_user_id_is_guardian_of(p.student_id)));
create policy payment_allocations_select_self on payment_allocations for select
  using (exists (
    select 1 from payments p
    join students st on st.id = p.student_id
    join school_users su on su.id = st.school_user_id
    where p.id = payment_allocations.payment_id and su.auth_user_id = auth.uid()
  ));

-- Recomputes one invoice's status from its allocated payments + approved discounts. Cheap (single
-- row), called after any change to allocations or discount approval — this is the "index
-- (school_id, status)" the blueprint calls for; the school-wide balance aggregate stays
-- computed-on-read (see the balances view in a later migration), only this one flag is maintained.
create or replace function recompute_invoice_status(p_invoice_id uuid) returns void
language plpgsql security definer set search_path = public as $$
declare
  v_total numeric;
  v_paid numeric;
  v_discounted numeric;
begin
  select total_amount into v_total from invoices where id = p_invoice_id;
  if v_total is null then return; end if;

  select coalesce(sum(amount_allocated), 0) into v_paid from payment_allocations where invoice_id = p_invoice_id;
  select coalesce(sum(amount), 0) into v_discounted from discounts where invoice_id = p_invoice_id and status = 'approved';

  update invoices set
    status = case
      when (v_paid + v_discounted) >= v_total then 'paid'
      when (v_paid + v_discounted) > 0 then 'partially_paid'
      else 'unpaid'
    end,
    updated_at = now()
  where id = p_invoice_id;
end;
$$;

revoke execute on function recompute_invoice_status(uuid) from public, anon, authenticated;

create or replace function trg_recompute_invoice_status_from_allocation() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  perform recompute_invoice_status(coalesce(new.invoice_id, old.invoice_id));
  return coalesce(new, old);
end;
$$;

create trigger payment_allocations_recompute_status
  after insert or update or delete on payment_allocations
  for each row execute function trg_recompute_invoice_status_from_allocation();

-- Records a payment and allocates it. If p_allocations is null, allocates FIFO across the student's
-- oldest outstanding invoices first (blueprint Part D), oldest by created_at. If p_allocations is
-- provided ([{invoice_id, amount}, ...]), the bursar's explicit allocation is used instead — but
-- must sum to no more than the payment amount and only reference the same student's invoices.
-- Any unallocated remainder (overpayment) is intentionally left unallocated for now — there's no
-- credit-balance/prepayment-carryover mechanism yet; flagged as a known gap, not a silent drop.
create or replace function record_payment(
  p_student_id uuid,
  p_method text,
  p_amount numeric,
  p_reference text default null,
  p_phone_number text default null,
  p_mpesa_checkout_request_id text default null,
  p_allocations jsonb default null
) returns uuid
language plpgsql security definer set search_path = public as $$
declare
  v_school_id uuid := auth_school_id();
  v_recorded_by uuid;
  v_payment_id uuid;
  v_remaining numeric := p_amount;
  v_invoice record;
  v_alloc jsonb;
  v_alloc_invoice_id uuid;
  v_alloc_amount numeric;
begin
  if not auth_has_permission('finance.write') then
    raise exception 'Not authorized to record payments.';
  end if;
  if not exists (select 1 from students where id = p_student_id and school_id = v_school_id) then
    raise exception 'Student not found in your school.';
  end if;

  select id into v_recorded_by from school_users where auth_user_id = auth.uid();

  insert into payments (school_id, student_id, method, amount, reference, phone_number, mpesa_checkout_request_id, recorded_by)
  values (v_school_id, p_student_id, p_method, p_amount, p_reference, p_phone_number, p_mpesa_checkout_request_id, v_recorded_by)
  returning id into v_payment_id;

  if p_allocations is not null then
    for v_alloc in select * from jsonb_array_elements(p_allocations) loop
      v_alloc_invoice_id := (v_alloc->>'invoice_id')::uuid;
      v_alloc_amount := (v_alloc->>'amount')::numeric;
      if not exists (select 1 from invoices where id = v_alloc_invoice_id and student_id = p_student_id and school_id = v_school_id) then
        raise exception 'Invoice % does not belong to this student.', v_alloc_invoice_id;
      end if;
      if v_alloc_amount > v_remaining then
        raise exception 'Allocations exceed the payment amount.';
      end if;
      insert into payment_allocations (payment_id, invoice_id, amount_allocated) values (v_payment_id, v_alloc_invoice_id, v_alloc_amount);
      v_remaining := v_remaining - v_alloc_amount;
    end loop;
  else
    for v_invoice in
      select id, total_amount,
        total_amount - coalesce((select sum(amount_allocated) from payment_allocations where invoice_id = invoices.id), 0)
          - coalesce((select sum(amount) from discounts where invoice_id = invoices.id and status = 'approved'), 0) as outstanding
      from invoices
      where student_id = p_student_id and school_id = v_school_id and status != 'paid'
      order by created_at asc
    loop
      exit when v_remaining <= 0;
      if v_invoice.outstanding <= 0 then continue; end if;
      declare v_apply numeric := least(v_remaining, v_invoice.outstanding);
      begin
        insert into payment_allocations (payment_id, invoice_id, amount_allocated) values (v_payment_id, v_invoice.id, v_apply);
        v_remaining := v_remaining - v_apply;
      end;
    end loop;
  end if;

  return v_payment_id;
end;
$$;

revoke execute on function record_payment(uuid, text, numeric, text, text, text, jsonb) from public, anon;
grant execute on function record_payment(uuid, text, numeric, text, text, text, jsonb) to authenticated;
