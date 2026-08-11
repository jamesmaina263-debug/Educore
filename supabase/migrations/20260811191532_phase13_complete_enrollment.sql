-- Phase 13: Admissions — Checklist, Final Review, Enrollment, Transaction Safety
-- (Brief 4.16.10–4.16.13)
--
-- Both functions below are plain plpgsql functions, which Postgres runs inside a single implicit
-- transaction — this is the "use real database transactions if the current backend supports them"
-- path from 4.16.12, not a client-side multi-step orchestration. Any exception raised partway
-- through complete_enrollment() rolls back everything it already did in this call; nothing it
-- writes is ever left half-done. This deliberately does NOT re-create the Student/Guardian/
-- Boarding/Transport/Health records Phase 12's wizard steps already create for real as the
-- officer progresses — see that migration's comment. Each "create/update" step here is a
-- create-if-missing/verify-if-present check, which is what 4.16.11's "create/update" wording
-- (not "create") already implies, and it's also what the Phase 13 test checklist's "Simulated
-- failure during Boarding allocation" case exercises: an application whose Boarding step was
-- skipped in the wizard reaches Complete Enrollment still missing that allocation, and the
-- checklist blocks it by name before any Finance/history work happens.

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

-- No write policy — only complete_enrollment() (security definer) inserts here.

-- ----------------------------------------------------------------------------
-- Checklist (Brief 4.16.10). Returns one row per MISSING required item, with the
-- exact wording the UI shows verbatim. An application with zero rows is ready to
-- complete. Optional items (Health, unless a school configures it — no such
-- per-school toggle exists yet, so Health never blocks, matching "never block
-- for optional information") are deliberately absent from this list.
-- ----------------------------------------------------------------------------
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
    return; -- nothing downstream can be checked without a student
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

-- ----------------------------------------------------------------------------
-- Complete Enrollment (Brief 4.16.11, 4.16.12). Idempotent: if this application is
-- already 'enrolled', returns the prior result instead of erroring or redoing work —
-- covers double-click / slow-connection resubmission without a client-side lock.
-- ----------------------------------------------------------------------------
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

  -- Idempotency: already completed — return the recorded result, do nothing further.
  if v_app.status = 'enrolled' then
    select * into v_history from public.admission_enrollment_history where application_id = p_application_id order by created_at desc limit 1;
    if found then
      return query select v_history.student_id, v_history.admission_number, v_history.invoice_id, v_history.payment_reference,
        (select total_amount from public.invoices where id = v_history.invoice_id);
      return;
    end if;
    -- No history row (shouldn't happen) — fall through and let the checks below fail loudly
    -- rather than silently re-running against an already-enrolled student.
  end if;

  -- 1. Validate all required info (Brief 4.16.10) — block naming the exact missing item.
  select message into v_first_missing from public.check_admission_checklist(p_application_id) limit 1;
  if v_first_missing is not null then
    raise exception '%', v_first_missing;
  end if;

  -- 2. Eligibility already implied by reaching here with zero missing items and status != enrolled.
  if v_app.status = 'enrolled' then
    raise exception 'This admission was already completed but its history record is missing — contact support before retrying.';
  end if;

  -- 3. Create/activate the master Student (already created by the wizard's Student step —
  --    this call only flips it from the interim 'approved' onboarding status to 'active').
  update public.students set status = 'active' where id = v_app.resulting_student_id and status <> 'active';

  -- 4. Guardian, 6. Academic placement, 7. Boarding, 8. Transport are all already verified
  --    present by the checklist above — nothing to create here, only confirmed.

  -- 5. Link verified Documents: re-point them from the application onto the student now that
  --    enrollment is final (documents_one_owner_check requires exactly one owner).
  update public.documents
  set student_id = v_app.resulting_student_id, application_id = null
  where application_id = p_application_id and verification_status = 'verified';

  -- 9. Health profile — optional, nothing to enforce; already saved by Phase 12 if provided.

  -- 10. Finance account + invoice, and the officer's staged initial payment if any. Recording a
  --     payment needs finance.write — an Admissions Officer often won't have it, so this is
  --     best-effort and never fails the enrollment itself; an unrecorded initial payment is
  --     something Finance/Bursar can record afterward, unlike a missing Student/Boarding/
  --     Transport record, which the checklist above already refuses to proceed past.
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

  -- 12. Admission/student number: already generated at the wizard's Student step (Phase 12
  --     requires it there) — nothing new to generate, per that step's own design note.

  -- 14. Mark admission completed/enrolled.
  update public.applications set status = 'enrolled', updated_at = now() where id = p_application_id;

  -- 11 & 13. Record admission/enrollment history + audit info.
  insert into public.admission_enrollment_history (school_id, application_id, student_id, completed_by, admission_number, invoice_id, payment_reference)
  select v_app.school_id, p_application_id, v_app.resulting_student_id, v_actor, s.admission_number, v_finance.invoice_id, v_finance.payment_reference
  from public.students s where s.id = v_app.resulting_student_id
  returning * into v_history;

  insert into public.audit_log (school_id, actor_school_user_id, table_name, record_id, action, new_data)
  values (v_app.school_id, v_actor, 'applications', p_application_id, 'complete_enrollment',
    jsonb_build_object('student_id', v_app.resulting_student_id, 'admission_number', v_history.admission_number));

  -- 15. Communication is triggered by the calling TS action (best-effort, non-blocking) since
  --     dispatch goes through an Edge Function this SQL function can't invoke directly.

  return query select v_history.student_id, v_history.admission_number, v_history.invoice_id, v_history.payment_reference,
    (select total_amount from public.invoices where id = v_history.invoice_id);
end;
$$;

revoke execute on function public.complete_enrollment(uuid) from public, anon;
grant execute on function public.complete_enrollment(uuid) to authenticated;

comment on function public.complete_enrollment(uuid) is 'Single-transaction, idempotent enrollment finalizer (Brief 4.16.11/4.16.12). Raises with the exact missing-item message on an incomplete checklist; any other exception rolls back everything this call did, leaving no orphaned student.';
