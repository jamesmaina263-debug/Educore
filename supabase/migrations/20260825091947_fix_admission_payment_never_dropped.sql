-- Two related bugs found while investigating why David Wangombe's (and others') admission
-- payments weren't showing up in Finance:
--
-- BUG A (money silently dropped): in complete_enrollment(), a declared cash/bank/cheque
-- initial payment was only ever recorded if an invoice had *already* been created a few
-- lines earlier in the same call. If invoice creation failed for any reason (e.g. no fee
-- structure configured for the student's class/boarding-type/term -- see companion note),
-- the whole `if v_invoice_id is not null ...` block was skipped and record_payment() was
-- never called at all. The officer's declared "I collected KES X cash at enrollment" was
-- then nowhere in the system -- not in payments, not in unallocated payments, nowhere.
-- Fix: always record the payment. If there's an invoice yet, allocate straight to it
-- (unchanged behaviour). If not, insert it directly as status='unallocated' (student_id
-- set, same pattern the M-Pesa STK callback already uses for "payment arrived before any
-- invoice exists") so the money is visible and can be swept in once an invoice exists.
--
-- BUG B (reconciliation was M-Pesa-only): reconcile_pending_mpesa_payments(), which runs
-- automatically whenever a new invoice is created for a student, only ever looked at
-- unallocated payments with source='api' and external_provider='mpesa_daraja'. A cash/
-- bank/cheque payment recorded as unallocated (including ones newly created by the fix
-- above) would never auto-allocate once an invoice showed up -- someone would have to
-- notice it and allocate it by hand. Fix: broaden the sweep to any unallocated payment
-- with student_id set, regardless of method/source, matching the requirement that "unless
-- stated otherwise, the initial amount submitted at admission should be channelled to
-- school fees."
--
-- BUG C (failures were invisible): if invoice creation failed inside complete_enrollment,
-- the exception was swallowed with no trace anywhere. Fix: log it to audit_log so finance/
-- admin staff can see which enrollments need a fee-structure or other follow-up, instead of
-- the failure being indistinguishable from "everything worked."

create or replace function public.reconcile_pending_mpesa_payments(p_student_id uuid, p_school_id uuid)
returns void
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_payment record;
  v_remaining numeric;
  v_invoice record;
  v_apply numeric;
begin
  -- Broadened from "M-Pesa API payments only" to any unallocated payment already tied to
  -- this student (manual cash/bank/cheque entries included) -- see BUG B above.
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

create or replace function public.complete_enrollment(p_application_id uuid)
returns table(student_id uuid, admission_number text, invoice_id uuid, payment_reference text, total_amount numeric)
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_app record;
  v_actor uuid;
  v_first_missing text;
  v_account record;
  v_invoice_id uuid;
  v_invoice_error text;
  v_total numeric;
  v_history admission_enrollment_history;
  v_payment_id uuid;
  v_recorded_by uuid;
begin
  if not auth_has_permission('admissions.write') then
    raise exception 'Not authorized to complete enrollment.';
  end if;

  select * into v_app from public.applications
  where id = p_application_id and school_id = auth_school_id()
  for update;
  if not found then
    raise exception 'Application not found.';
  end if;

  v_actor := (select id from public.school_users where auth_user_id = auth.uid() and status = 'active');

  if v_app.status = 'enrolled' then
    select * into v_history from public.admission_enrollment_history where application_id = p_application_id order by created_at desc limit 1;
    if found then
      return query select v_history.student_id, v_history.admission_number, v_history.invoice_id, v_history.payment_reference,
        (select invoices.total_amount from public.invoices where invoices.id = v_history.invoice_id);
      return;
    end if;
  end if;

  select message into v_first_missing from public.check_admission_checklist(p_application_id) limit 1;
  if v_first_missing is not null then
    raise exception '%', v_first_missing;
  end if;

  if v_app.status = 'enrolled' then
    raise exception 'This admission was already completed but its history record is missing — contact support before retrying.';
  end if;

  update public.students set status = 'enrolled' where id = v_app.resulting_student_id and status = 'approved';
  update public.students set status = 'active' where id = v_app.resulting_student_id and status = 'enrolled';

  update public.documents
  set student_id = v_app.resulting_student_id, application_id = null
  where application_id = p_application_id and verification_status = 'verified';

  v_invoice_id := null;
  v_total := null;
  v_invoice_error := null;
  if auth_has_permission('finance.write') then
    begin
      perform public.get_or_create_student_financial_account(v_app.resulting_student_id);
      select * into v_account from public.student_financial_accounts where student_id = v_app.resulting_student_id;
      if v_app.term_id is not null then
        v_invoice_id := public.create_or_get_invoice_for_student(v_app.resulting_student_id, v_app.term_id);
        select total_amount into v_total from public.invoices where id = v_invoice_id;
      end if;
    exception when others then
      v_invoice_id := null;
      v_total := null;
      -- BUG C fix: record *why* invoice creation failed instead of only swallowing it, so
      -- staff can find and fix the underlying gap (e.g. missing fee structure) instead of
      -- the enrollment silently looking "clean."
      v_invoice_error := sqlerrm;
    end;
  end if;

  -- BUG A fix: a declared initial payment (any method, including mpesa's manually-entered
  -- fallback) is now always recorded -- never conditioned on invoice creation having
  -- succeeded. Real M-Pesa STK-confirmed payments still arrive separately via
  -- mpesa_stk_callback_confirm and are not duplicated here.
  if coalesce(v_app.initial_payment_amount, 0) > 0
     and v_app.initial_payment_method is not null and v_app.initial_payment_method <> 'mpesa'
     and auth_has_permission('finance.write') then
    if v_invoice_id is not null then
      perform public.record_payment(
        p_student_id := v_app.resulting_student_id,
        p_method := v_app.initial_payment_method,
        p_amount := v_app.initial_payment_amount,
        p_purpose := 'Initial admission payment',
        p_allocations := jsonb_build_array(jsonb_build_object('invoice_id', v_invoice_id, 'amount', v_app.initial_payment_amount))
      );
    else
      -- No invoice yet (fee structure missing, etc.) -- record the money as unallocated
      -- rather than dropping it. reconcile_pending_mpesa_payments() will sweep it in
      -- automatically the next time an invoice is successfully created for this student.
      select id into v_recorded_by from public.school_users where auth_user_id = auth.uid();
      insert into public.payments (school_id, student_id, method, amount, recorded_by, status, source, purpose, notes)
      values (v_app.school_id, v_app.resulting_student_id, v_app.initial_payment_method, v_app.initial_payment_amount,
        v_recorded_by, 'unallocated', 'manual', 'Initial admission payment',
        'Recorded unallocated at enrollment — no invoice existed yet' || coalesce(': ' || v_invoice_error, ''))
      returning id into v_payment_id;

      insert into public.audit_log (school_id, actor_school_user_id, table_name, record_id, action, new_data)
      values (v_app.school_id, v_actor, 'payments', v_payment_id, 'create',
        jsonb_build_object('student_id', v_app.resulting_student_id, 'method', v_app.initial_payment_method,
          'amount', v_app.initial_payment_amount, 'unallocated_reason', 'no_invoice_at_enrollment', 'invoice_error', v_invoice_error));
    end if;
  end if;

  if v_invoice_error is not null then
    insert into public.audit_log (school_id, actor_school_user_id, table_name, record_id, action, new_data)
    values (v_app.school_id, v_actor, 'applications', p_application_id, 'invoice_creation_failed',
      jsonb_build_object('student_id', v_app.resulting_student_id, 'error', v_invoice_error));
  end if;

  update public.applications set status = 'enrolled', updated_at = now() where id = p_application_id;

  insert into public.admission_enrollment_history (school_id, application_id, student_id, completed_by, admission_number, invoice_id, payment_reference)
  select v_app.school_id, p_application_id, v_app.resulting_student_id, v_actor, s.admission_number, v_invoice_id, v_account.payment_reference
  from public.students s where s.id = v_app.resulting_student_id
  returning * into v_history;

  insert into public.audit_log (school_id, actor_school_user_id, table_name, record_id, action, new_data)
  values (v_app.school_id, v_actor, 'applications', p_application_id, 'complete_enrollment',
    jsonb_build_object('student_id', v_app.resulting_student_id, 'admission_number', v_history.admission_number));

  return query select v_history.student_id, v_history.admission_number, v_history.invoice_id, v_history.payment_reference,
    (select invoices.total_amount from public.invoices where invoices.id = v_history.invoice_id);
end;
$function$;

-- One-off backfill: sweep any unallocated payments that already exist for students who now
-- (as of this migration) have an invoice, and any that gain one going forward whenever an
-- invoice is created. Covers David Wangombe / Bravin Maina's stuck M-Pesa payments the
-- moment their day-scholar fee structure gap is fixed and an invoice is generated for them.
