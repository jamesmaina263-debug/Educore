-- Reconciliation: applied live by another session (commit a6e06e9, "Fix M-Pesa admission
-- payments: create invoice up front, auto-reconcile") as
-- "mpesa_auto_allocate_and_admission_invoice_timing" but never committed to the repo. Written
-- here from the current live definitions to keep git and the database in sync, matching this
-- repo's established reconciliation convention.
--
-- This supersedes an earlier, narrower attempt at the same problem (complete_enrollment
-- reconciling STK payments at enrollment time, applied then overwritten live by this session
-- while the two ran concurrently -- flagged and resolved as a real collision, not silently
-- discarded). This version is a better fix: it creates the real invoice as soon as the wizard's
-- Finance step loads charges (the fee structure is already committed to by then), so a
-- confirmed STK push applies straight to it -- no unallocated-payment limbo, no bursar
-- reconciliation step, for admissions or any other invoice-creation path.

-- payments.student_id is no longer forced to NULL when status='unallocated' -- a payment can
-- now be confirmed-to-a-known-student and still awaiting an invoice to apply to.
alter table public.payments drop constraint if exists payments_student_id_status_consistency;
alter table public.payments add constraint payments_student_id_status_consistency
  check (status = 'unallocated' or student_id is not null);

-- mpesa_stk_callback_confirm: preserves student_id on payments that land before an invoice
-- exists (previously wiped to NULL), so reconcile_pending_mpesa_payments (below) can find them
-- by student_id once an invoice is created.
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

  update public.mpesa_stk_requests
  set status = 'completed', result_code = p_result_code, result_desc = p_result_desc,
      payment_id = v_payment_id, resolved_at = now()
  where id = v_request.id;
end;
$function$;

-- New: called from create_or_get_invoice_for_student whenever a NEW invoice is created, for
-- any student -- admissions or ordinary invoicing alike. Finds M-Pesa payments already
-- confirmed-to-this-student (student_id set, status still 'unallocated' because no invoice
-- existed at confirm time) and allocates them, oldest first, exactly like
-- allocate_unallocated_payment's own auto-allocate fallback.
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
  for v_payment in
    select id, amount from public.payments
    where student_id = p_student_id
      and school_id = p_school_id
      and status = 'unallocated'
      and source = 'api'
      and external_provider = 'mpesa_daraja'
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
revoke all on function public.reconcile_pending_mpesa_payments(uuid, uuid) from public;
revoke execute on function public.reconcile_pending_mpesa_payments(uuid, uuid) from anon;
grant execute on function public.reconcile_pending_mpesa_payments(uuid, uuid) to authenticated, service_role;

-- create_or_get_invoice_for_student: unchanged resolution logic, now calls
-- reconcile_pending_mpesa_payments() at the end, right after the invoice (and any waivers) are
-- created.
create or replace function public.create_or_get_invoice_for_student(p_student_id uuid, p_term_id uuid)
returns uuid
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_school_id uuid := auth_school_id();
  v_existing_id uuid;
  v_class_id uuid;
  v_structure_id uuid;
  v_transport_structure_id uuid;
  v_total numeric;
  v_invoice_id uuid;
  v_term_start date;
  v_is_boarder boolean;
  v_has_transport boolean;
  v_waiver record;
  v_waiver_amount numeric;
begin
  if not auth_has_permission('finance.write') then
    raise exception 'Not authorized to generate invoices.';
  end if;

  select id into v_existing_id from invoices where student_id = p_student_id and term_id = p_term_id;
  if v_existing_id is not null then
    return v_existing_id;
  end if;

  select str.class_id into v_class_id
    from students st join streams str on str.id = st.current_class_id
    where st.id = p_student_id and st.school_id = v_school_id;
  if v_class_id is null then
    raise exception 'Student has no class/stream assigned — cannot resolve a fee structure.';
  end if;

  select start_date into v_term_start from terms where id = p_term_id;
  select exists (select 1 from hostel_allocations where student_id = p_student_id and status = 'active') into v_is_boarder;
  select exists (select 1 from student_transport_assignments where student_id = p_student_id and status = 'active') into v_has_transport;

  select id into v_structure_id from fee_structures
    where school_id = v_school_id and term_id = p_term_id and class_id = v_class_id
      and fee_category = 'core' and boarding_type = (case when v_is_boarder then 'boarder' else 'day' end) and is_active
    limit 1;
  if v_structure_id is null then
    select id into v_structure_id from fee_structures
      where school_id = v_school_id and term_id = p_term_id and class_id is null
        and fee_category = 'core' and boarding_type = (case when v_is_boarder then 'boarder' else 'day' end) and is_active
      limit 1;
  end if;
  if v_structure_id is null then
    raise exception 'No fee structure configured for this student''s class/boarding-type/term.';
  end if;

  select coalesce(sum(amount), 0) into v_total from fee_items where fee_structure_id = v_structure_id;

  if v_has_transport then
    select id into v_transport_structure_id from fee_structures
      where school_id = v_school_id and term_id = p_term_id and class_id = v_class_id
        and fee_category = 'transport' and is_active
      limit 1;
    if v_transport_structure_id is null then
      select id into v_transport_structure_id from fee_structures
        where school_id = v_school_id and term_id = p_term_id and class_id is null
          and fee_category = 'transport' and is_active
        limit 1;
    end if;
    if v_transport_structure_id is not null then
      v_total := v_total + coalesce((select sum(amount) from fee_items where fee_structure_id = v_transport_structure_id), 0);
    end if;
  end if;

  insert into invoices (school_id, student_id, term_id, fee_structure_id, total_amount)
  values (v_school_id, p_student_id, p_term_id, v_structure_id, v_total)
  returning id into v_invoice_id;

  insert into invoice_items (invoice_id, name, amount)
  select v_invoice_id, name, amount from fee_items where fee_structure_id = v_structure_id;
  if v_transport_structure_id is not null then
    insert into invoice_items (invoice_id, name, amount)
    select v_invoice_id, name, amount from fee_items where fee_structure_id = v_transport_structure_id;
  end if;

  for v_waiver in
    select fw.id, fw.discount_kind, fw.discount_value, fw.name
    from fee_waivers fw
    where fw.student_id = p_student_id
      and fw.status = 'active'
      and (fw.starts_term_id is null or exists (
        select 1 from terms t where t.id = fw.starts_term_id and t.start_date <= v_term_start))
      and (fw.ends_term_id is null or exists (
        select 1 from terms t where t.id = fw.ends_term_id and t.start_date >= v_term_start))
  loop
    v_waiver_amount := case
      when v_waiver.discount_kind = 'percentage' then round(v_total * v_waiver.discount_value / 100, 2)
      else least(v_waiver.discount_value, v_total)
    end;

    insert into discounts (school_id, student_id, invoice_id, amount, reason, status, waiver_id, approved_at)
    values (v_school_id, p_student_id, v_invoice_id, v_waiver_amount,
      'Auto-applied waiver: ' || v_waiver.name, 'approved', v_waiver.id, now());
  end loop;

  perform public.reconcile_pending_mpesa_payments(p_student_id, v_school_id);

  return v_invoice_id;
end;
$function$;

-- complete_enrollment: only cash/bank/cheque are ever recorded on the officer's declared
-- amount now -- 'mpesa' is excluded from that branch entirely, since real M-Pesa money only
-- ever posts via the Daraja-confirmed callback + reconcile_pending_mpesa_payments above (called
-- when this function's own call to create_or_get_invoice_for_student runs, a moment earlier).
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
  v_total numeric;
  v_history admission_enrollment_history;
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
    end;
  end if;

  if v_invoice_id is not null and coalesce(v_app.initial_payment_amount, 0) > 0
     and v_app.initial_payment_method is not null and v_app.initial_payment_method <> 'mpesa'
     and auth_has_permission('finance.write') then
    perform public.record_payment(
      p_student_id := v_app.resulting_student_id,
      p_method := v_app.initial_payment_method,
      p_amount := v_app.initial_payment_amount,
      p_purpose := 'Initial admission payment',
      p_allocations := jsonb_build_array(jsonb_build_object('invoice_id', v_invoice_id, 'amount', v_app.initial_payment_amount))
    );
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
