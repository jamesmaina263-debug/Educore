-- Bug: check_admission_checklist() blocks Complete Enrollment on "Bed Allocation is missing"
-- whenever the application's stored boarding_preference = 'boarding', regardless of whether
-- the school currently has boarding enabled at all (schools.boarding_enabled).
--
-- The rest of the app already treats a school's boarding_preference as effectively "day" once
-- boarding_enabled is turned off for that school -- see applicableStepCount() in
-- src/app/(app)/admissions/wizard-steps.ts ("Mirrors ... even for a draft whose
-- boarding_preference predates the school's flag being turned off") and the matching comment/
-- logic in step-forms.tsx (both from #314). This DB function was the one place that check was
-- missing, so a draft application created back when a school offered boarding -- e.g. Little
-- Beginners School, which has since disabled boarding (schools.boarding_enabled = false) --
-- gets permanently stuck: there's no bed-allocation UI to satisfy the check (boarding is off),
-- and no way to edit boarding_preference back to "day" from the Admission Details step other
-- than re-saving it (the form silently forces "day" when boardingModuleEnabled is false, but
-- that only writes to the DB if the officer happens to revisit and re-save Step 1).
--
-- Fix: only require an active bed allocation when the school actually has boarding enabled.
-- Only the boarding branch changes; every other check, the signature, security definer, and
-- search_path are untouched (create or replace preserves existing grants).
--
-- Applied live to production on 2026-09-17 (this exact SQL, version 20260917093841) after
-- confirming via a live-session simulation that it clears the blocker for the affected
-- application (John Ndung'u, Little Beginners School) without touching any data. Committing
-- here now to close the drift gap per the standing migration-filename-drift convention.
create or replace function public.check_admission_checklist(p_application_id uuid)
returns table (item text, message text)
language plpgsql security definer set search_path = public as $$
declare
  v_app record;
  v_boarding_enabled boolean;
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

  if not exists (select 1 from public.medical_records where student_id = v_app.resulting_student_id) then
    return query select 'health', 'Admission cannot be completed because the Health profile has not been recorded.';
  end if;

  if not exists (
    select 1 from public.fee_structures where school_id = v_app.school_id and term_id = v_app.term_id
  ) then
    return query select 'finance', 'Admission cannot be completed because no Fee Structure is configured for this term.';
  end if;

  select boarding_enabled into v_boarding_enabled from public.schools where id = v_app.school_id;

  -- New: only enforce a bed allocation when the school currently has boarding enabled. A
  -- stale boarding_preference = 'boarding' on a school that has since disabled boarding is
  -- treated as inapplicable, same as everywhere else in the app.
  if coalesce(v_boarding_enabled, true) and v_app.boarding_preference = 'boarding' and not exists (
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
