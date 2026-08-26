-- Gap 2 (audit): walk-in applications bypass all screening (interview/assessment/decision).
-- createWalkInApplication() legitimately needs to stay fast (walk-ins can't wait for the
-- full online-review pipeline), so this is NOT a change to that function's behavior.
-- Instead, this adds the smallest code-level compensating control: a required confirmation
-- flag on the application, gated at enrollment time via check_admission_checklist(), that an
-- officer must explicitly confirm before a walk-in can be enrolled.
--
-- NOTE: this file was recovered from the live Supabase project on 2026-08-26. It was applied
-- directly to production (version 20260826071024) but the corresponding migration file was
-- never committed to this repo, so the repo and production had drifted. Recommitting it here,
-- verbatim as it exists live, to close that gap -- no logic changed from what's already running.
--
-- Still outstanding as of this recovery: there is no frontend code anywhere in this repo that
-- sets walk_in_screening_confirmed to true (no checkbox at Admission Details Step 1, as the
-- original task called for). Until that UI exists, every walk-in application created will be
-- permanently blocked from completing enrollment by this same gate. Flagging for follow-up.

alter table public.applications
  add column if not exists walk_in_screening_confirmed boolean not null default false;

create or replace function public.check_admission_checklist(p_application_id uuid)
returns table(item text, message text)
language plpgsql
security definer
set search_path to 'public'
as $function$
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
$function$;
