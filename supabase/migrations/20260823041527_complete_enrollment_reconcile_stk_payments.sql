-- Makes the admissions wizard's M-Pesa STK push fully automatic at Complete Enrollment time.
-- See repo migration 20260822080000_complete_enrollment_reconcile_stk_payments.sql for full
-- design rationale.
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
  v_finance record;
  v_history admission_enrollment_history;
  v_stk_payment record;
  v_stk_collected numeric;
  v_remaining_to_charge numeric;
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

  select * into v_finance from public.finance_on_student_enrolled(v_app.resulting_student_id);

  v_stk_collected := 0;
  if v_finance.invoice_id is not null and auth_has_permission('finance.write') then
    for v_stk_payment in
      select p.id as payment_id, p.amount
      from public.mpesa_stk_requests r
      join public.payments p on p.id = r.payment_id
      where r.student_id = v_app.resulting_student_id
        and r.status = 'completed'
        and p.status = 'unallocated'
      order by r.resolved_at asc
    loop
      perform public.allocate_unallocated_payment(v_stk_payment.payment_id, v_app.resulting_student_id);
      v_stk_collected := v_stk_collected + v_stk_payment.amount;
    end loop;
  end if;

  v_remaining_to_charge := greatest(coalesce(v_app.initial_payment_amount, 0) - v_stk_collected, 0);
  if v_remaining_to_charge > 0 and v_finance.invoice_id is not null and auth_has_permission('finance.write') then
    perform public.record_payment(
      p_student_id := v_app.resulting_student_id,
      p_method := coalesce(v_app.initial_payment_method, 'cash'),
      p_amount := v_remaining_to_charge,
      p_purpose := 'Initial admission payment',
      p_allocations := jsonb_build_array(jsonb_build_object('invoice_id', v_finance.invoice_id, 'amount', v_remaining_to_charge))
    );
  end if;

  update public.applications set status = 'enrolled', updated_at = now() where id = p_application_id;

  insert into public.admission_enrollment_history (school_id, application_id, student_id, completed_by, admission_number, invoice_id, payment_reference)
  select v_app.school_id, p_application_id, v_app.resulting_student_id, v_actor, s.admission_number, v_finance.invoice_id, v_finance.payment_reference
  from public.students s where s.id = v_app.resulting_student_id
  returning * into v_history;

  insert into public.audit_log (school_id, actor_school_user_id, table_name, record_id, action, new_data)
  values (v_app.school_id, v_actor, 'applications', p_application_id, 'complete_enrollment',
    jsonb_build_object('student_id', v_app.resulting_student_id, 'admission_number', v_history.admission_number));

  return query select v_history.student_id, v_history.admission_number, v_history.invoice_id, v_history.payment_reference,
    (select invoices.total_amount from public.invoices where invoices.id = v_history.invoice_id);
end;
$function$;
