-- Fixes a real over-allocation gap in record_payment()'s explicit-allocations path.
--
-- record_payment() has two ways of applying a payment to invoices: an auto-allocation branch
-- (no p_allocations) that correctly clamps each invoice's share to `least(remaining,
-- outstanding)`, and an explicit-allocations branch (p_allocations passed in) that only checked
-- the *sum* of allocations against the payment amount -- it never checked a single allocation
-- against that invoice's own outstanding balance. mpesa_stk_callback_confirm, which allocates
-- M-Pesa confirmations, already does this correctly (also via `least(remaining, outstanding)`).
--
-- The gap bites concretely via complete_enrollment(): the Admissions wizard's Finance step
-- deliberately allows an initial payment larger than the term's invoice total (documented as a
-- legitimate advance for a future term). complete_enrollment() then calls record_payment() with
-- a single explicit allocation sending the *entire* amount to the one invoice just created. The
-- excess got force-allocated to that invoice instead of staying unallocated, so it never showed
-- up as the student's credit_balance (v_student_balances) -- the advance effectively vanished
-- from view until the next term's invoice was generated, at which point the student would
-- incorrectly show as fully unpaid despite the school already holding the money.
--
-- Fix: clamp each explicit allocation to `least(caller's amount, that invoice's actual
-- outstanding)`, same as the auto-allocation branch and mpesa_stk_callback_confirm already do.
-- Any portion that doesn't fit is left unallocated and correctly surfaces as credit.

CREATE OR REPLACE FUNCTION public.record_payment(p_student_id uuid, p_method text, p_amount numeric, p_reference text DEFAULT NULL::text, p_phone_number text DEFAULT NULL::text, p_mpesa_checkout_request_id text DEFAULT NULL::text, p_allocations jsonb DEFAULT NULL::jsonb, p_purpose text DEFAULT NULL::text, p_notes text DEFAULT NULL::text)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_school_id uuid := auth_school_id();
  v_recorded_by uuid;
  v_payment_id uuid;
  v_remaining numeric := p_amount;
  v_invoice record;
  v_alloc jsonb;
  v_alloc_invoice_id uuid;
  v_alloc_amount numeric;
  v_alloc_outstanding numeric;
  v_alloc_apply numeric;
begin
  if not auth_has_permission('finance.write') then
    raise exception 'Not authorized to record payments.';
  end if;
  if not exists (select 1 from students where id = p_student_id and school_id = v_school_id) then
    raise exception 'Student not found in your school.';
  end if;

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

      select total_amount
          - coalesce((select sum(amount_allocated) from payment_allocations where invoice_id = invoices.id), 0)
          - coalesce((select sum(amount) from discounts where invoice_id = invoices.id and status = 'approved'), 0)
        into v_alloc_outstanding
      from invoices where id = v_alloc_invoice_id;

      v_alloc_apply := least(v_alloc_amount, greatest(v_alloc_outstanding, 0));
      if v_alloc_apply > 0 then
        insert into payment_allocations (payment_id, invoice_id, amount_allocated, entry_type) values (v_payment_id, v_alloc_invoice_id, v_alloc_apply, 'allocation');
      end if;
      v_remaining := v_remaining - v_alloc_apply;
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
