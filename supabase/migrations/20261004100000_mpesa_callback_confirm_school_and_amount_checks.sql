-- Security audit finding H2 (M-Pesa callback authenticity).
--
-- mpesa_stk_callback_confirm() trusted two attacker-influenceable inputs:
--   1. It looked the STK request up by checkout_request_id alone and never checked that the
--      request belongs to the school whose callback_token the edge function validated.
--   2. It recorded coalesce(p_amount, v_request.amount) -- i.e. whatever Amount the callback
--      body claimed -- without comparing it to the amount that was actually requested.
--
-- Fix (both inside the function, so they hold even if the edge function is bypassed):
--   * New optional p_school_id. When supplied, the request must belong to that school, else
--     the call raises. The edge function now always passes the school_id it validated.
--     It is DEFAULT NULL only so the currently deployed edge function (which does not send it
--     yet) keeps working between this migration and the function deploy. A follow-up migration
--     should drop the default once the new edge function is live.
--   * A successful callback whose Amount differs from the requested amount by >= 0.01 is NOT
--     recorded. The request stays 'pending' (so the genuine Safaricom callback can still
--     complete it), result_desc is tagged 'AMOUNT_MISMATCH: ...', and an audit_log row is
--     written. The edge function raises a security alert when it sees that tag.
--
-- The old 6-argument signature is dropped (CREATE OR REPLACE would leave it callable, without
-- these checks). Callers using named arguments (PostgREST rpc) resolve to the new function.
-- Body is otherwise the currently deployed function, unchanged.
--
-- Rollback: re-create the previous 6-argument definition from
-- 20260917184040_mpesa_callback_confirm_idempotent_unique_violation.sql and
-- drop the 7-argument one.

drop function if exists public.mpesa_stk_callback_confirm(text, integer, text, text, numeric, text);

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

  -- NEW: the request must belong to the school whose callback token was presented.
  if p_school_id is not null and v_request.school_id <> p_school_id then
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

-- Server-side only: strip every default grant, then give service_role (the edge function) EXECUTE.
revoke all on function public.mpesa_stk_callback_confirm(text, integer, text, text, numeric, text, uuid) from public, anon, authenticated;
grant execute on function public.mpesa_stk_callback_confirm(text, integer, text, text, numeric, text, uuid) to service_role;

-- Verify; raise (rolling back this migration) if the lockdown did not take effect.
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
