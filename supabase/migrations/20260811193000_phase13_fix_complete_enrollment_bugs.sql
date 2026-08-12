-- ============================================================
-- Two fixes to complete_enrollment() (Phase 13), found by actually calling
-- it end-to-end against a real fixture application that passed every
-- admission checklist item -- both bugs meant it could never succeed as
-- originally written, for any application:
--
-- 1. It tried to flip a student directly from 'approved' to 'active'. The
--    pre-existing state machine (enforce_student_status_transition, Phase
--    1) only allows approved -> enrolled -> active as two separate legal
--    steps, not approved -> active directly. Confirmed live: reproduced
--    "invalid student status transition: approved -> active" before this
--    fix. Now two updates instead of one.
--
-- 2. Its own returns-table OUT column named total_amount collided with
--    the unqualified invoices.total_amount referenced in both of its
--    RETURN QUERY statements -- the same class of bug as
--    resolve_fee_charges_for_student's fee_category collision (Phase 8).
--    Confirmed live: reproduced "column reference total_amount is
--    ambiguous" before this fix. Now qualified as invoices.total_amount.
--
-- Everything else is byte-for-byte identical to what Phase 13 already
-- pushed. Re-tested live after this fix: a fixture application with every
-- checklist item satisfied now completes successfully, the student status
-- correctly ends at 'active', and a second call is a no-op (idempotent),
-- exactly as Phase 13's own design intends.
-- ============================================================

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
        (select invoices.total_amount from public.invoices where invoices.id = v_history.invoice_id);
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
  --    this call flips it from the interim 'approved' onboarding status to 'active'). Two
  --    updates, not one: the state machine requires enrolled as an intermediate step.
  update public.students set status = 'enrolled' where id = v_app.resulting_student_id and status = 'approved';
  update public.students set status = 'active' where id = v_app.resulting_student_id and status = 'enrolled';

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
    (select invoices.total_amount from public.invoices where invoices.id = v_history.invoice_id);
end;
$$;
