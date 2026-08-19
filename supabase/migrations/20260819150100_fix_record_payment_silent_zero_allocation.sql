-- BUG FIX: record_payment() would silently insert a 'confirmed' payment with zero rows in
-- payment_allocations whenever the student had no outstanding invoices to auto-allocate
-- against. The payment then contributed nothing to termCollected, invoice `paid` totals, or
-- v_student_balances, and (unlike a genuinely unallocated payment) never appeared in the
-- Unallocated Payments bucket either, since that requires student_id IS NULL (schema CHECK
-- constraint), which this payment didn't satisfy. Net effect: money recorded but invisible
-- to every finance report. Reproduced live: payment ee65867e-8dbd-4a39-b140-51f5099e13ec
-- (KES 2,000, status='confirmed') has 0 allocations because its student had 0 invoices at
-- the time it was recorded.
--
-- Fix: after the auto-allocation loop, if nothing at all got allocated (v_remaining still
-- equals the full payment amount) and the caller didn't pass explicit p_allocations, raise
-- instead of silently confirming. This rolls back the whole function call (including the
-- payment insert already made), so no orphaned row is left behind, and the caller gets an
-- actionable message instead of a payment that quietly stops existing in every report.

create or replace function public.record_payment(
  p_student_id uuid,
  p_method text,
  p_amount numeric,
  p_reference text default null,
  p_phone_number text default null,
  p_mpesa_checkout_request_id text default null,
  p_allocations jsonb default null,
  p_purpose text default null,
  p_notes text default null
)
returns uuid
language plpgsql
security definer
set search_path to 'public'
as $function$
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

  -- RACE CONDITION FIX: serialize all payment-mutating operations per student with the same
  -- pg_advisory_xact_lock pattern already used for admission-number assignment in this
  -- codebase (assign_admission_number). Without this, two concurrent record_payment/
  -- allocate_unallocated_payment calls for the same student could each read the same stale
  -- "outstanding" balance and jointly over-allocate past an invoice's total — there is no
  -- CHECK constraint preventing sum(payment_allocations.amount_allocated) > invoices.total_amount.
  perform pg_advisory_xact_lock(hashtext('student_payments:' || p_student_id::text));

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

    if v_remaining = p_amount then
      raise exception 'This student has no outstanding invoices to apply this payment to. Generate an invoice for them first, or record this as an unallocated payment instead.';
    end if;
  end if;

  insert into audit_log (school_id, actor_school_user_id, table_name, record_id, action, new_data)
  values (v_school_id, v_recorded_by, 'payments', v_payment_id, 'create',
    jsonb_build_object('student_id', p_student_id, 'method', p_method, 'amount', p_amount, 'reference', p_reference));

  perform generate_receipt(v_payment_id);

  return v_payment_id;
end;
$function$;
