-- RACE CONDITION FIX (continued from the record_payment migration): allocate_unallocated_payment
-- and reverse_payment have the same unguarded read-then-write pattern on invoice outstanding /
-- payment reversible balances. Serialized per student with the same pg_advisory_xact_lock
-- pattern already used for admission-number assignment (assign_admission_number). The lock is
-- held for the duration of the calling transaction and released automatically on commit/
-- rollback — no new deadlock surface, since each of these functions only ever locks one
-- student at a time.

create or replace function public.allocate_unallocated_payment(p_payment_id uuid, p_student_id uuid, p_allocations jsonb default null)
returns void
language plpgsql
security definer
set search_path to 'public'
as $function$
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

  perform pg_advisory_xact_lock(hashtext('student_payments:' || p_student_id::text));

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
$function$;

create or replace function public.reverse_payment(p_payment_id uuid, p_amount numeric, p_reason text)
returns void
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_school_id uuid := auth_school_id();
  v_payment record;
  v_already_reversed numeric;
  v_already_allocated numeric;
  v_to_pull_back numeric;
  v_alloc record;
  v_apply numeric;
  v_actor uuid;
begin
  if not auth_has_permission('finance.write') then
    raise exception 'Not authorized to reverse payments.';
  end if;
  if p_amount <= 0 then
    raise exception 'Reversal amount must be positive.';
  end if;

  select * into v_payment from payments where id = p_payment_id and school_id = v_school_id;
  if v_payment.id is null then
    raise exception 'Payment not found.';
  end if;
  if v_payment.status = 'unallocated' then
    raise exception 'Cannot reverse an unallocated payment — allocate or delete it is not supported; contact support.';
  end if;

  if v_payment.student_id is not null then
    perform pg_advisory_xact_lock(hashtext('student_payments:' || v_payment.student_id::text));
  end if;

  select coalesce(sum(amount), 0) into v_already_reversed from payment_reversals where payment_id = p_payment_id;
  if p_amount > (v_payment.amount - v_already_reversed) then
    raise exception 'Reversal amount exceeds the remaining reversible amount on this payment.';
  end if;

  select id into v_actor from school_users where auth_user_id = auth.uid();

  insert into payment_reversals (payment_id, amount, reason, reversed_by) values (p_payment_id, p_amount, p_reason, v_actor);

  select coalesce(sum(amount_allocated), 0) into v_already_allocated
    from payment_allocations where payment_id = p_payment_id;
  v_to_pull_back := least(p_amount, greatest(v_already_allocated, 0));

  for v_alloc in
    select invoice_id, amount_allocated from payment_allocations
    where payment_id = p_payment_id and entry_type = 'allocation'
    order by created_at desc
  loop
    exit when v_to_pull_back <= 0;
    v_apply := least(v_to_pull_back, v_alloc.amount_allocated);
    insert into payment_allocations (payment_id, invoice_id, amount_allocated, entry_type)
      values (p_payment_id, v_alloc.invoice_id, -v_apply, 'reversal');
    v_to_pull_back := v_to_pull_back - v_apply;
  end loop;

  update payments set status = 'reversed'
    where id = p_payment_id and (v_already_reversed + p_amount) >= amount;

  insert into audit_log (school_id, actor_school_user_id, table_name, record_id, action, reason, new_data)
  values (v_school_id, v_actor, 'payments', p_payment_id, 'reverse', p_reason, jsonb_build_object('amount_reversed', p_amount));
end;
$function$;
