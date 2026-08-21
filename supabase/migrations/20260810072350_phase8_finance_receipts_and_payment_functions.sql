
-- ============================================================
-- STEP 4 (was file 3): Receipts
-- ============================================================
create sequence if not exists receipt_number_seq;

create table receipts (
  id uuid primary key default gen_random_uuid(),
  school_id uuid not null references schools(id) on delete cascade,
  payment_id uuid not null unique references payments(id) on delete cascade,
  student_id uuid not null references students(id) on delete cascade,
  receipt_number text not null,
  issued_at timestamptz not null default now(),
  unique (school_id, receipt_number)
);
comment on table receipts is 'One receipt per confirmed, student-allocated payment (unique on payment_id — never a second receipt for the same payment, satisfying "one receipt system, not two"). Generated automatically by generate_receipt(), called from record_payment() and allocate_unallocated_payment().';

create index receipts_student_id_idx on receipts (student_id);
create index receipts_school_id_idx on receipts (school_id);

alter table receipts enable row level security;

create policy receipts_select on receipts for select
  using (
    (school_id = auth_school_id() and auth_has_permission('finance.read'))
    or auth_user_id_is_guardian_of(receipts.student_id)
    or exists (
      select 1 from students st join school_users su on su.id = st.school_user_id
      where st.id = receipts.student_id and su.auth_user_id = (select auth.uid())
    )
  );

create or replace function generate_receipt(p_payment_id uuid)
returns receipts
language plpgsql security definer set search_path = public as $$
declare
  v_receipt receipts;
  v_school_id uuid;
  v_student_id uuid;
  v_number text;
begin
  select * into v_receipt from receipts where payment_id = p_payment_id;
  if v_receipt.id is not null then
    return v_receipt;
  end if;

  select school_id, student_id into v_school_id, v_student_id from payments where id = p_payment_id;
  if v_student_id is null then
    return null;
  end if;

  v_number := 'RCT-' || to_char(now(), 'YYYY') || '-' || lpad(nextval('receipt_number_seq')::text, 6, '0');

  insert into receipts (school_id, payment_id, student_id, receipt_number)
  values (v_school_id, p_payment_id, v_student_id, v_number)
  returning * into v_receipt;

  return v_receipt;
end;
$$;

revoke execute on function generate_receipt(uuid) from public, anon;
grant execute on function generate_receipt(uuid) to authenticated;


-- ============================================================
-- STEP 5 (remainder of file 4): payment recording functions.
-- entry_type (step 3) and generate_receipt() (step 4) now both exist.
-- ============================================================
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
