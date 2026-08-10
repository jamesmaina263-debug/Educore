-- Phase 8, Items 5-11: payment status model, future-API-readiness columns, manual payment
-- workflow extensions, unallocated payments, duplicate protection. Structural only — no outbound
-- HTTP calls, no mock provider, no simulated webhook (brief §4.7 / build plan Phase 8 explicitly
-- forbids building the API itself).

-- id already serves as the internal transaction id (every payment already has a stable uuid) —
-- deliberately not duplicating it into a second column.
alter table payments
  add column status text not null default 'confirmed'
    check (status in ('pending', 'recorded', 'confirmed', 'reversed', 'unallocated')),
  add column source text not null default 'manual' check (source in ('manual', 'api')),
  add column external_provider text,
  add column purpose text,
  add column notes text,
  add column confirmed_at timestamptz not null default now();
comment on column payments.status is 'confirmed = a manual entry the Finance Officer has independently verified (the default and, for now, the only real path). pending/recorded/reversed/unallocated exist so a future payment-intake API/webhook can land in the same pipeline without a redesign (brief §4.7 item 7/8) — no API produces these yet.';
comment on column payments.source is 'manual (the only value ever written today) vs api (reserved for a future payment-intake integration — not built, no code path sets this yet).';
comment on column payments.external_provider is 'Reserved for a future API integration (e.g. "mpesa", "equity-bank") to record which external system a payment came from. Null for every manual entry today.';

-- student_id becomes nullable to support the Unallocated Payments queue (brief §4.7 item 9) —
-- a payment that cannot be confidently matched to a student on entry.
alter table payments alter column student_id drop not null;
alter table payments add constraint payments_student_id_status_consistency
  check ((status = 'unallocated' and student_id is null) or (status <> 'unallocated' and student_id is not null));

-- Duplicate protection (brief §4.7 item 11): the same external reference for the same method
-- should never be recorded twice. Partial so a reversed payment's reference can legitimately be
-- re-entered if the school genuinely re-receives that same payment later.
create unique index payments_school_method_reference_unique
  on payments (school_id, method, reference)
  where reference is not null and status <> 'reversed';

create index payments_status_idx on payments (school_id, status);

-- Records a manual payment already confirmed by the Finance Officer (per-invoice allocation or
-- FIFO, unchanged from the original function) — now also stamping status/source/purpose/notes
-- and guaranteeing the student has a Financial Account before the payment lands, and generating
-- a receipt. Two new trailing params (p_purpose, p_notes) means this is a distinct overload in
-- Postgres, not an in-place replace — drop the original 7-arg signature explicitly so no caller
-- can silently keep hitting the old function that skips status/receipt generation.
drop function if exists record_payment(uuid, text, numeric, text, text, text, jsonb);

create or replace function record_payment(
  p_student_id uuid,
  p_method text,
  p_amount numeric,
  p_reference text default null,
  p_phone_number text default null,
  p_mpesa_checkout_request_id text default null,
  p_allocations jsonb default null,
  p_purpose text default null,
  p_notes text default null
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

  -- Every enrolled student paying anything needs a Financial Account; create it here if this
  -- is somehow the first Finance touchpoint for this student (defensive — the Admissions
  -- enrollment hook is the normal creation point).
  perform get_or_create_student_financial_account(p_student_id);

  select id into v_recorded_by from school_users where auth_user_id = auth.uid();

  insert into payments (school_id, student_id, method, amount, reference, phone_number, mpesa_checkout_request_id, recorded_by, status, source, purpose, notes)
  values (v_school_id, p_student_id, p_method, p_amount, p_reference, p_phone_number, p_mpesa_checkout_request_id, v_recorded_by, 'confirmed', 'manual', p_purpose, p_notes)
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
      insert into payment_allocations (payment_id, invoice_id, amount_allocated, entry_type) values (v_payment_id, v_alloc_invoice_id, v_alloc_amount, 'allocation');
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
        insert into payment_allocations (payment_id, invoice_id, amount_allocated, entry_type) values (v_payment_id, v_invoice.id, v_apply, 'allocation');
        v_remaining := v_remaining - v_apply;
      end;
    end loop;
    -- Any remainder is overpayment: it stays on the account as unapplied credit (never lost,
    -- brief §4.7 item 12) — v_student_balances.credit_balance surfaces it, and future invoices
    -- can be paid down using it via the credit-application path in allocate_unallocated_payment.
  end if;

  insert into audit_log (school_id, actor_school_user_id, table_name, record_id, action, new_data)
  values (v_school_id, v_recorded_by, 'payments', v_payment_id, 'create',
    jsonb_build_object('student_id', p_student_id, 'method', p_method, 'amount', p_amount, 'reference', p_reference));

  perform generate_receipt(v_payment_id);

  return v_payment_id;
end;
$$;

revoke execute on function record_payment(uuid, text, numeric, text, text, text, jsonb, text, text) from public, anon;
grant execute on function record_payment(uuid, text, numeric, text, text, text, jsonb, text, text) to authenticated;

-- Records a payment that cannot be confidently matched to a student on entry (brief §4.7 item 9)
-- — lands in the Unallocated Payments queue instead of being guessed at.
create or replace function record_unallocated_payment(
  p_method text,
  p_amount numeric,
  p_reference text default null,
  p_phone_number text default null,
  p_purpose text default null,
  p_notes text default null
) returns uuid
language plpgsql security definer set search_path = public as $$
declare
  v_school_id uuid := auth_school_id();
  v_recorded_by uuid;
  v_payment_id uuid;
begin
  if not auth_has_permission('finance.write') then
    raise exception 'Not authorized to record payments.';
  end if;

  select id into v_recorded_by from school_users where auth_user_id = auth.uid();

  insert into payments (school_id, student_id, method, amount, reference, phone_number, recorded_by, status, source, purpose, notes)
  values (v_school_id, null, p_method, p_amount, p_reference, p_phone_number, v_recorded_by, 'unallocated', 'manual', p_purpose, p_notes)
  returning id into v_payment_id;

  insert into audit_log (school_id, actor_school_user_id, table_name, record_id, action, new_data)
  values (v_school_id, v_recorded_by, 'payments', v_payment_id, 'create',
    jsonb_build_object('status', 'unallocated', 'method', p_method, 'amount', p_amount, 'reference', p_reference));

  return v_payment_id;
end;
$$;

revoke execute on function record_unallocated_payment(text, numeric, text, text, text, text) from public, anon;
grant execute on function record_unallocated_payment(text, numeric, text, text, text, text) to authenticated;

-- An authorized Finance Officer investigates an Unallocated payment and allocates it to the
-- correct student — the allocation itself is audited (brief §4.7 item 9), and the original
-- payment row (method/amount/reference/recorded_at) is never altered, only its student_id and
-- status, preserving the original payment data unchanged.
create or replace function allocate_unallocated_payment(
  p_payment_id uuid,
  p_student_id uuid,
  p_allocations jsonb default null
) returns void
language plpgsql security definer set search_path = public as $$
declare
  v_school_id uuid := auth_school_id();
  v_actor uuid;
  v_amount numeric;
  v_remaining numeric;
  v_invoice record;
  v_alloc jsonb;
  v_alloc_invoice_id uuid;
  v_alloc_amount numeric;
begin
  if not auth_has_permission('finance.write') then
    raise exception 'Not authorized to allocate payments.';
  end if;
  select amount into v_amount from payments
    where id = p_payment_id and school_id = v_school_id and status = 'unallocated';
  if v_amount is null then
    raise exception 'Unallocated payment not found.';
  end if;
  if not exists (select 1 from students where id = p_student_id and school_id = v_school_id) then
    raise exception 'Student not found in your school.';
  end if;

  perform get_or_create_student_financial_account(p_student_id);
  select id into v_actor from school_users where auth_user_id = auth.uid();

  update payments set student_id = p_student_id, status = 'confirmed' where id = p_payment_id;

  v_remaining := v_amount;
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
      insert into payment_allocations (payment_id, invoice_id, amount_allocated, entry_type) values (p_payment_id, v_alloc_invoice_id, v_alloc_amount, 'allocation');
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
        insert into payment_allocations (payment_id, invoice_id, amount_allocated, entry_type) values (p_payment_id, v_invoice.id, v_apply, 'allocation');
        v_remaining := v_remaining - v_apply;
      end;
    end loop;
  end if;

  insert into audit_log (school_id, actor_school_user_id, table_name, record_id, action, new_data)
  values (v_school_id, v_actor, 'payments', p_payment_id, 'allocate',
    jsonb_build_object('allocated_to_student_id', p_student_id, 'amount', v_amount));

  perform generate_receipt(p_payment_id);
end;
$$;

revoke execute on function allocate_unallocated_payment(uuid, uuid, jsonb) from public, anon;
grant execute on function allocate_unallocated_payment(uuid, uuid, jsonb) to authenticated;
