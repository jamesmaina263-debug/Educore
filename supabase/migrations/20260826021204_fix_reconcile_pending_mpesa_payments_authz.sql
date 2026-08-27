-- Reconstructed from live schema introspection (Supabase project alzqlvfaftwegptfbfej).
-- Original SQL never committed to the repo. Current live definition rejects a caller
-- reconciling payments for a school other than their own, unless they're a super admin.

CREATE OR REPLACE FUNCTION public.reconcile_pending_mpesa_payments(p_student_id uuid, p_school_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_payment record;
  v_remaining numeric;
  v_invoice record;
  v_apply numeric;
begin
  if auth.uid() is not null then
    if not auth_is_super_admin() and p_school_id is distinct from auth_school_id() then
      raise exception 'insufficient privileges to reconcile payments for another school';
    end if;
  end if;

  perform pg_advisory_xact_lock(hashtext('student_payments:' || p_student_id::text));

  -- Broadened from "M-Pesa API payments only" to any unallocated payment already tied to
  -- this student (manual cash/bank/cheque entries included) -- see BUG B, prior migration.
  for v_payment in
    select id, amount from public.payments
    where student_id = p_student_id
      and school_id = p_school_id
      and status = 'unallocated'
    order by recorded_at asc
  loop
    v_remaining := v_payment.amount;

    for v_invoice in
      select id, total_amount,
        total_amount - coalesce((select sum(amount_allocated) from public.payment_allocations where invoice_id = invoices.id), 0)
          - coalesce((select sum(amount) from public.discounts where invoice_id = invoices.id and status = 'approved'), 0) as outstanding
      from public.invoices
      where student_id = p_student_id and school_id = p_school_id and status != 'paid'
      order by created_at asc
    loop
      exit when v_remaining <= 0;
      if v_invoice.outstanding <= 0 then continue; end if;
      v_apply := least(v_remaining, v_invoice.outstanding);
      insert into public.payment_allocations (payment_id, invoice_id, amount_allocated, entry_type)
        values (v_payment.id, v_invoice.id, v_apply, 'allocation');
      v_remaining := v_remaining - v_apply;
    end loop;

    if v_remaining < v_payment.amount then
      update public.payments set status = 'confirmed' where id = v_payment.id;
      perform public.generate_receipt(v_payment.id);
      insert into public.audit_log (school_id, table_name, record_id, action, new_data)
        values (p_school_id, 'payments', v_payment.id, 'auto_allocate',
          jsonb_build_object('student_id', p_student_id, 'trigger', 'invoice_available', 'amount', v_payment.amount));
    end if;
  end loop;
end;
$function$;
