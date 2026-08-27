-- Real bug found during live verification of the admissions integration: mpesa_stk_callback_confirm
-- calls get_or_create_student_financial_account(), which internally requires
-- auth_has_permission('finance.write' or 'students.write') -- but ONLY when the student has no
-- existing student_financial_accounts row yet. That check depends on auth.uid(), which is null
-- in the mpesa-stk-callback webhook's service-role context (no human session). Every first-ever
-- confirmed M-Pesa payment for a student with no prior financial activity would have failed here
-- -- reproduced live against a synthetic newly-created applicant-stage student before this fix.
--
-- Rather than weaken the original, audited get_or_create_student_financial_account() (used by
-- record_payment() and other genuinely user-session-driven paths, where the permission check is
-- correct and should stay), this is a narrow webhook-only variant with the same account-creation
-- logic minus that check -- authorization for the webhook path is already established by the
-- matched mpesa_stk_requests row itself (created via initiate_mpesa_stk_request's own
-- finance.write check at push time), so re-checking auth.uid()-based permission at confirm time
-- is both redundant and structurally impossible to satisfy.
create or replace function public.ensure_student_financial_account_for_webhook(p_student_id uuid)
returns void
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_school_id uuid;
  v_reference text;
begin
  if exists (select 1 from public.student_financial_accounts where student_id = p_student_id) then
    return;
  end if;

  select school_id into v_school_id from public.students where id = p_student_id;
  if v_school_id is null then
    raise exception 'Student not found.';
  end if;

  v_reference := 'EDU' || lpad(nextval('public.student_payment_reference_seq')::text, 5, '0');

  insert into public.student_financial_accounts (school_id, student_id, payment_reference)
  values (v_school_id, p_student_id, v_reference)
  on conflict (student_id) do nothing;
end;
$function$;
revoke all on function public.ensure_student_financial_account_for_webhook(uuid) from public;
revoke execute on function public.ensure_student_financial_account_for_webhook(uuid) from anon, authenticated;
grant execute on function public.ensure_student_financial_account_for_webhook(uuid) to service_role;

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

  if v_outstanding <= 0 then
    insert into public.payments (school_id, student_id, method, amount, reference, phone_number, mpesa_checkout_request_id, recorded_by, status, source, external_provider, notes)
    values (v_request.school_id, null, 'mpesa', coalesce(p_amount, v_request.amount), p_receipt_number, coalesce(p_phone_number, v_request.phone_number), p_checkout_request_id, v_request.initiated_by, 'unallocated', 'api', 'mpesa_daraja', v_request.notes)
    returning id into v_payment_id;

    insert into public.audit_log (school_id, actor_school_user_id, table_name, record_id, action, new_data)
    values (v_request.school_id, v_request.initiated_by, 'payments', v_payment_id, 'create',
      jsonb_build_object('student_id_intended', v_request.student_id, 'method', 'mpesa', 'amount', coalesce(p_amount, v_request.amount), 'reference', p_receipt_number, 'unallocated_reason', 'no_outstanding_invoice'));
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

  update public.mpesa_stk_requests
  set status = 'completed', result_code = p_result_code, result_desc = p_result_desc,
      payment_id = v_payment_id, resolved_at = now()
  where id = v_request.id;
end;
$function$;
revoke all on function public.mpesa_stk_callback_confirm(text, integer, text, text, numeric, text) from public;
revoke execute on function public.mpesa_stk_callback_confirm(text, integer, text, text, numeric, text) from anon, authenticated;
grant execute on function public.mpesa_stk_callback_confirm(text, integer, text, text, numeric, text) to service_role;
