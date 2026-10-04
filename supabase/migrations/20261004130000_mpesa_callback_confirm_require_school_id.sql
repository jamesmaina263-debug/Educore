-- Follow-up to 20261004100000 (audit finding H2): make p_school_id mandatory.
--
-- That migration added p_school_id as optional (DEFAULT NULL) so the previously deployed edge
-- function kept working between the migration and the function deploy. Both callers now send it
-- (mpesa-stk-callback since #537, mpesa-stk-query since #538) and a genuine Safaricom callback
-- has been confirmed end to end in production under that code (2026-10-04 11:39 UTC), so the
-- function now rejects a missing school instead of silently skipping the ownership check.
--
-- Postgres cannot drop a DEFAULT from one parameter while the ones before it keep theirs, so the
-- signature is unchanged and the requirement is enforced inside the function. CREATE OR REPLACE
-- keeps the existing grants (service_role only); the block at the end verifies that.
--
-- Rollback: re-apply the function body from 20261004100000 (the `p_school_id is not null and`
-- form of the check).

create or replace function public.mpesa_stk_callback_confirm(
  p_checkout_request_id text,
  p_result_code integer,
  p_result_desc text,
  p_receipt_number text default null,
  p_amount numeric default null,
  p_phone_number text default null,
  p_school_id uuid default null
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

  -- The request must belong to the school whose callback token was presented. p_school_id is now
  -- mandatory: both callers (mpesa-stk-callback, mpesa-stk-query) always send it.
  if p_school_id is null then
    raise exception 'p_school_id is required.';
  end if;
  if v_request.school_id <> p_school_id then
    raise exception 'STK request does not belong to the school presented with this callback.';
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

  -- NEW: never record a payment for an amount other than the one that was requested.
  if p_amount is not null and abs(p_amount - v_request.amount) >= 0.01 then
    update public.mpesa_stk_requests
    set result_desc = left('AMOUNT_MISMATCH: callback ' || p_amount::text || ' vs requested ' || v_request.amount::text, 200)
    where id = v_request.id;

    insert into public.audit_log (school_id, actor_school_user_id, table_name, record_id, action, new_data)
    values (v_request.school_id, v_request.initiated_by, 'mpesa_stk_requests', v_request.id, 'update',
      jsonb_build_object('event', 'callback_amount_mismatch_rejected',
        'callback_amount', p_amount, 'requested_amount', v_request.amount,
        'receipt', p_receipt_number));
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
      -- Another concurrent delivery of the same callback already won the race and inserted the
      -- payments row. Legitimate idempotent-duplicate case, not an error: look up what the other
      -- transaction recorded so this request can still advance to 'completed' below.
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


do $verify$
begin
  if has_function_privilege('anon', 'public.mpesa_stk_callback_confirm(text, integer, text, text, numeric, text, uuid)', 'EXECUTE')
     or has_function_privilege('authenticated', 'public.mpesa_stk_callback_confirm(text, integer, text, text, numeric, text, uuid)', 'EXECUTE') then
    raise exception 'mpesa_stk_callback_confirm is executable by anon/authenticated';
  end if;
  if not has_function_privilege('service_role', 'public.mpesa_stk_callback_confirm(text, integer, text, text, numeric, text, uuid)', 'EXECUTE') then
    raise exception 'service_role lost EXECUTE on mpesa_stk_callback_confirm';
  end if;
end
$verify$;
