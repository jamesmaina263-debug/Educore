-- Gap found in the admissions-process audit: check_admission_checklist() verifies
-- Guardian, Documents, Academics (class/stream), Finance (fee structure), Boarding, and
-- Transport before complete_enrollment() is allowed to run -- but never Health. A student
-- can therefore be fully enrolled with zero medical_records data (no blood group, no
-- allergies/conditions, and critically no emergency contact), which is a real safety gap.
--
-- Fix: add a Health item to the checklist, following the exact same "return query select
-- item, message" pattern already used for the other checks (e.g. the Academics check).
-- Blocks completion if no medical_records row exists yet for the resulting student.
-- Existing already-enrolled students are unaffected -- this function only runs at
-- enrollment time (called from complete_enrollment()), so no backfill is needed.
--
-- Only the body changes; signature, security definer, search_path, and grants are
-- untouched (create or replace preserves the existing revoke/grant already set on this
-- function by the Phase 13 migration).
--
-- NOTE: this is written against the function as it actually exists in production today,
-- which already includes the walk_in_screening check (Task 2, applied directly to
-- Supabase as of 20260826071024_walk_in_screening_confirmation_gate) -- that migration
-- file is not yet present in this repo checkout, so the repo and production have
-- drifted. This migration preserves that check rather than reverting it.

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

  if v_app.application_source = 'walk_in' and not coalesce(v_app.walk_in_screening_confirmed, false) then
    return query select 'walk_in_screening', 'Admission cannot be completed because walk-in screening has not been confirmed.';
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

  -- New: Health check, added by this migration.
  if not exists (select 1 from public.medical_records where student_id = v_app.resulting_student_id) then
    return query select 'health', 'Admission cannot be completed because the Health profile has not been recorded.';
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
