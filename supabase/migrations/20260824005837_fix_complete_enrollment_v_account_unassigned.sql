-- Reconstructed from live schema introspection (Supabase project alzqlvfaftwegptfbfej).
-- Original SQL never committed to the repo.
--
-- complete_enrollment() is touched by three gap migrations in this backfill pass; see
-- 20260823041527_complete_enrollment_reconcile_stk_payments.sql for the full body and an
-- important open-question note about v_account. This file intentionally re-applies the same
-- verbatim live definition (CREATE OR REPLACE is a no-op on repeat) so the migration history
-- stays complete without guessing at the exact historical diff boundary between the two.

CREATE OR REPLACE FUNCTION public.complete_enrollment(p_application_id uuid)
 RETURNS TABLE(student_id uuid, admission_number text, invoice_id uuid, payment_reference text, total_amount numeric)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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
      select * into v_account from public.student_financial_accounts sfa
        where sfa.student_id = v_app.resulting_student_id;
      if v_app.term_id is not null then
        v_invoice_id := public.create_or_get_invoice_for_student(v_app.resulting_student_id, v_app.term_id);
        select inv.total_amount into v_total from public.invoices inv where inv.id = v_invoice_id;
      end if;
    exception when others then
      v_invoice_id := null;
      v_total := null;
      v_invoice_error := sqlerrm;
    end;
  end if;

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
