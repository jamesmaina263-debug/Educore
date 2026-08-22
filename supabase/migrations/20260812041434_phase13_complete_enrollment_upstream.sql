create table public.admission_enrollment_history (
  id uuid primary key default gen_random_uuid(),
  school_id uuid not null references public.schools(id) on delete cascade,
  application_id uuid not null references public.applications(id),
  student_id uuid not null references public.students(id),
  completed_by uuid references public.school_users(id),
  admission_number text not null,
  invoice_id uuid references public.invoices(id),
  payment_reference text,
  created_at timestamptz not null default now()
);

create index idx_admission_enrollment_history_application on public.admission_enrollment_history(application_id);
create index idx_admission_enrollment_history_student on public.admission_enrollment_history(student_id);

alter table public.admission_enrollment_history enable row level security;

create policy admission_enrollment_history_select on public.admission_enrollment_history
  for select using (
    auth_is_super_admin()
    or (school_id = auth_school_id() and (auth_has_permission('admissions.read_any') or auth_has_permission('students.read')))
  );

create or replace function public.check_admission_checklist(p_application_id uuid)
returns table (item text, message text)
language plpgsql security definer set search_path = public as $$
declare
  v_app record;
begin
  select a.*, s.status as student_status
  into v_app
  from public.applications a
  left join public.students s on s.id = a.resulting_student_id
  where a.id = p_application_id and a.school_id = auth_school_id();

  if not found then
    raise exception 'Application not found.';
  end if;

  if v_app.resulting_student_id is null then
    return query select 'student', 'Admission cannot be completed because the Student record has not been created yet.';
    return;
  end if;

  if not exists (select 1 from public.student_guardians where student_id = v_app.resulting_student_id) then
    return query select 'guardian', 'Admission cannot be completed because Guardian is missing.';
  end if;

  if exists (
    select 1 from public.application_document_requirements r
    where r.school_id = v_app.school_id and r.required
      and not exists (
        select 1 from public.documents d
        where d.application_id = p_application_id and d.category = r.category and d.verification_status = 'verified'
      )
  ) then
    return query
      select 'documents', 'Admission cannot be completed because ' || r.label || ' is missing or not yet verified.'
      from public.application_document_requirements r
      where r.school_id = v_app.school_id and r.required
        and not exists (
          select 1 from public.documents d
          where d.application_id = p_application_id and d.category = r.category and d.verification_status = 'verified'
        );
  end if;

  if not exists (select 1 from public.students where id = v_app.resulting_student_id and current_class_id is not null) then
    return query select 'academics', 'Admission cannot be completed because Class/Stream placement is missing.';
  end if;

  if not exists (
    select 1 from public.fee_structures where school_id = v_app.school_id and term_id = v_app.term_id
  ) then
    return query select 'finance', 'Admission cannot be completed because no Fee Structure is configured for this term.';
  end if;

  if v_app.boarding_preference = 'boarding' and not exists (
    select 1 from public.hostel_allocations where student_id = v_app.resulting_student_id and status = 'active'
  ) then
    return query select 'boarding', 'Admission cannot be completed because Bed Allocation is missing.';
  end if;

  if v_app.transport_required and not exists (
    select 1 from public.student_transport_assignments where student_id = v_app.resulting_student_id and status = 'active'
  ) then
    return query select 'transport', 'Admission cannot be completed because Transport Assignment is missing.';
  end if;
end;
$$;

revoke execute on function public.check_admission_checklist(uuid) from public, anon;
grant execute on function public.check_admission_checklist(uuid) to authenticated;

create or replace function public.complete_enrollment(p_application_id uuid)
returns table (student_id uuid, admission_number text, invoice_id uuid, payment_reference text, total_amount numeric)
language plpgsql security definer set search_path = public as $$
declare
  v_app record;
  v_actor uuid;
  v_first_missing text;
  v_finance record;
  v_history admission_enrollment_history;
begin
  if not auth_has_permission('admissions.write') then
    raise exception 'Not authorized to complete enrollment.';
  end if;

  select * into v_app from public.applications where id = p_application_id and school_id = auth_school_id();
  if not found then
    raise exception 'Application not found.';
  end if;

  v_actor := (select id from public.school_users where auth_user_id = auth.uid() and status = 'active');

  if v_app.status = 'enrolled' then
    select * into v_history from public.admission_enrollment_history where application_id = p_application_id order by created_at desc limit 1;
    if found then
      return query select v_history.student_id, v_history.admission_number, v_history.invoice_id, v_history.payment_reference,
        (select total_amount from public.invoices where id = v_history.invoice_id);
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

  update public.students set status = 'active' where id = v_app.resulting_student_id and status <> 'active';

  update public.documents
  set student_id = v_app.resulting_student_id, application_id = null
  where application_id = p_application_id and verification_status = 'verified';

  select * into v_finance from public.finance_on_student_enrolled(v_app.resulting_student_id);
  if v_app.initial_payment_amount is not null and v_app.initial_payment_amount > 0
     and v_finance.invoice_id is not null and auth_has_permission('finance.write') then
    perform public.record_payment(
      p_student_id := v_app.resulting_student_id,
      p_method := coalesce(v_app.initial_payment_method, 'cash'),
      p_amount := v_app.initial_payment_amount,
      p_purpose := 'Initial admission payment',
      p_allocations := jsonb_build_array(jsonb_build_object('invoice_id', v_finance.invoice_id, 'amount', v_app.initial_payment_amount))
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
    (select total_amount from public.invoices where id = v_history.invoice_id);
end;
$$;

revoke execute on function public.complete_enrollment(uuid) from public, anon;
grant execute on function public.complete_enrollment(uuid) to authenticated;
