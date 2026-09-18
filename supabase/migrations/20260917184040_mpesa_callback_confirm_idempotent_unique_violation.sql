-- Fix: mpesa_stk_callback_confirm() has a real (if narrow) race window. The
-- `if v_request.status <> 'pending' then return;` guard reads v_request into a
-- local variable BEFORE the pg_advisory_xact_lock is acquired. Two genuinely
-- concurrent deliveries of the same Daraja callback (which Safaricom's own
-- retry behavior can produce) can both pass that check while status is still
-- 'pending' in both sessions, then serialize on the advisory lock -- but the
-- second invocation never re-reads status after acquiring the lock, so it
-- still attempts to insert a second `payments` row for the same
-- checkout_request_id.
--
-- This has NOT caused duplicate payments in production: the partial unique
-- index `payments_mpesa_checkout_request_id_idx` (finance_payments.sql) already
-- rejects the second insert at the database level, so no double-crediting is
-- possible today. But because the function has no exception handler, that
-- unique_violation propagates as an uncaught RPC error, which the edge
-- function (mpesa-stk-callback/index.ts) currently reports as
-- "M-Pesa callback confirm failed -- payment received but not recorded" --
-- a false-positive page for what is actually a correctly-deduplicated,
-- harmless retry. It also leaves that mpesa_stk_requests row stuck on
-- status='pending' forever instead of 'completed', which would confuse any
-- future reconciliation query that trusts that status column.
--
-- Fix: catch unique_violation specifically, treat it as the idempotent
-- success case it actually is, and still advance mpesa_stk_requests.status to
-- 'completed' (looking up the payment_id that won the race) instead of
-- leaving it on 'pending'.

create or replace function public.mpesa_stk_callback_confirm(
  p_checkout_request_id text,
  p_result_code integer,
  p_result_desc text,
  p_receipt_number text default null,
  p_amount numeric default null,
  p_phone_number text default null
)
returns void
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_request record;
  v_payment_id uuid;
  v_remaining numeric;
  v_outstanding numeric;
  v_invoice record;
begin
  select * into v_request from public.mpesa_stk_requests
    where checkout_request_id = p_checkout_request_id;

  if v_request.id is null then
    raise exception 'No STK request matches this checkout_request_id.';
  end if;
  if v_request.status <> 'pending' then
    return;
  end if;

  if p_result_code <> 0 then
    update public.mpesa_stk_requests
    set status = 'failed', result_code = p_result_code, result_desc = p_result_desc, resolved_at = now()
    where id = v_request.id;
    return;
  end if;

  perform pg_advisory_xact_lock(hashtext('student_payments:' || v_request.student_id::text));

  perform public.ensure_student_financial_account_for_webhook(v_request.student_id);

  select coalesce(sum(
    total_amount
      - coalesce((select sum(amount_allocated) from public.payment_allocations where invoice_id = invoices.id), 0)
      - coalesce((select sum(amount) from public.discounts where invoice_id = invoices.id and status = 'approved'), 0)
  ), 0) into v_outstanding
  from public.invoices
  where student_id = v_request.student_id and school_id = v_request.school_id and status != 'paid';

  begin
    if v_outstanding <= 0 then
      insert into public.payments (school_id, student_id, method, amount, reference, phone_number, mpesa_checkout_request_id, recorded_by, status, source, external_provider, notes)
      values (v_request.school_id, v_request.student_id, 'mpesa', coalesce(p_amount, v_request.amount), p_receipt_number, coalesce(p_phone_number, v_request.phone_number), p_checkout_request_id, v_request.initiated_by, 'unallocated', 'api', 'mpesa_daraja', v_request.notes)
      returning id into v_payment_id;

      insert into public.audit_log (school_id, actor_school_user_id, table_name, record_id, action, new_data)
      values (v_request.school_id, v_request.initiated_by, 'payments', v_payment_id, 'create',
        jsonb_build_object('student_id', v_request.student_id, 'method', 'mpesa', 'amount', coalesce(p_amount, v_request.amount), 'reference', p_receipt_number, 'unallocated_reason', 'no_outstanding_invoice_yet'));
    else
      insert into public.payments (school_id, student_id, method, amount, reference, phone_number, mpesa_checkout_request_id, recorded_by, status, source, external_provider, notes)
      values (v_request.school_id, v_request.student_id, 'mpesa', coalesce(p_amount, v_request.amount), p_receipt_number, coalesce(p_phone_number, v_request.phone_number), p_checkout_request_id, v_request.initiated_by, 'confirmed', 'api', 'mpesa_daraja', v_request.notes)
      returning id into v_payment_id;

      v_remaining := coalesce(p_amount, v_request.amount);

      if v_request.invoice_id is not null then
        select least(v_remaining,
          total_amount
            - coalesce((select sum(amount_allocated) from public.payment_allocations where invoice_id = invoices.id), 0)
            - coalesce((select sum(amount) from public.discounts where invoice_id = invoices.id and status = 'approved'), 0)
        ) into v_outstanding
        from public.invoices where id = v_request.invoice_id;
        if v_outstanding > 0 then
          insert into public.payment_allocations (payment_id, invoice_id, amount_allocated, entry_type)
            values (v_payment_id, v_request.invoice_id, v_outstanding, 'allocation');
          v_remaining := v_remaining - v_outstanding;
        end if;
      end if;

      for v_invoice in
        select id, total_amount,
          total_amount - coalesce((select sum(amount_allocated) from public.payment_allocations where invoice_id = invoices.id), 0)
            - coalesce((select sum(amount) from public.discounts where invoice_id = invoices.id and status = 'approved'), 0) as outstanding
        from public.invoices
        where student_id = v_request.student_id and school_id = v_request.school_id and status != 'paid'
        order by created_at asc
      loop
        exit when v_remaining <= 0;
        if v_invoice.outstanding <= 0 then continue; end if;
        declare v_apply numeric := least(v_remaining, v_invoice.outstanding);
        begin
          insert into public.payment_allocations (payment_id, invoice_id, amount_allocated, entry_type) values (v_payment_id, v_invoice.id, v_apply, 'allocation');
          v_remaining := v_remaining - v_apply;
        end;
      end loop;

      insert into public.audit_log (school_id, actor_school_user_id, table_name, record_id, action, new_data)
      values (v_request.school_id, v_request.initiated_by, 'payments', v_payment_id, 'create',
        jsonb_build_object('student_id', v_request.student_id, 'method', 'mpesa', 'amount', coalesce(p_amount, v_request.amount), 'reference', p_receipt_number));

      perform public.generate_receipt(v_payment_id);
    end if;
  exception
    when unique_violation then
      -- Another concurrent delivery of the same callback already won the
      -- race and inserted the payments row (see comment at top of file).
      -- This is the legitimate idempotent-duplicate case, not an error --
      -- look up what that other transaction recorded so we can still
      -- advance this request to 'completed' below instead of leaving it
      -- stuck on 'pending'.
      select id into v_payment_id
      from public.payments
      where mpesa_checkout_request_id = p_checkout_request_id
      limit 1;
  end;

  update public.mpesa_stk_requests
  set status = 'completed', result_code = p_result_code, result_desc = p_result_desc,
      payment_id = v_payment_id, resolved_at = now()
  where id = v_request.id;
end;
$function$;
