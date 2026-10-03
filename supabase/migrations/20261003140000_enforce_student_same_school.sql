-- N1 (security audit, MEDIUM): nothing stopped a row from pointing at a student in a
-- DIFFERENT school than the row's own school_id.
--
-- Every user-writable table that carries both school_id and student_id (sick_bay_visits,
-- report_cards, fee_waivers, discipline_*, health_*, student_attendance, ...) has INSERT/UPDATE
-- policies that only check `school_id = auth_school_id()` plus a permission. The student_id
-- is a plain FK to students(id), with no composite (school_id, id) FK. So a staff member in
-- school A could insert a row with school_id = A and student_id = <a student of school B>
-- (needs B's student uuid) via the REST API. Policies on several of these tables let a student's
-- guardian read rows by student_id alone, so school B's parent could be shown a record school A
-- planted. Earlier fixes (20260827054007, 20260917061705) patched the RPC functions, not these
-- direct-insert paths.
--
-- Fix: one BEFORE trigger function, attached to every user-writable table that has both
-- columns, rejecting a row whose student belongs to another school.
--
-- Safety (all verified against live production before writing this):
--   * Existing data: 0 rows with a student/school mismatch in any of the 37 candidate tables.
--   * No code path changes students.school_id (a 'transferred' student is only a status).
--   * On INSERT the check always runs. On UPDATE it runs ONLY when student_id or school_id
--     itself changes, so updating other columns on any legacy row is never blocked.
--   * NULL student_id (nullable on documents, library_*, whatsapp_conversations) is skipped.
--   * SECURITY DEFINER with a pinned search_path so the students lookup is not hidden by RLS --
--     otherwise a cross-tenant student would look "not found" to the caller and slip through.
--     An unknown student id is left to the existing FK to reject.
--   * Server-only tables (payments, invoices, receipts, ...) are intentionally NOT included;
--     users can't write them directly and they are written by owner-run functions.
--
-- Rollback:
--   drop trigger if exists trg_enforce_student_same_school on public.<table>;  -- per table
--   drop function if exists public.enforce_student_same_school();

create or replace function public.enforce_student_same_school()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_student_school uuid;
begin
  if new.student_id is null then
    return new;
  end if;

  select s.school_id into v_student_school from public.students s where s.id = new.student_id;

  -- Unknown student: let the existing foreign key report it.
  if not found then
    return new;
  end if;

  if v_student_school is distinct from new.school_id then
    raise exception 'student does not belong to this school'
      using errcode = '23514';
  end if;

  return new;
end;
$function$;

revoke all on function public.enforce_student_same_school() from public, anon, authenticated;

do $attach$
declare
  t text;
begin
  foreach t in array array[
    'boarding_incidents', 'boarding_transfers', 'certificates',
    'competency_indicator_ratings', 'competency_marks',
    'disciplinary_actions', 'discipline_cases', 'discipline_records',
    'documents', 'fee_threshold_alerts', 'fee_waivers',
    'health_emergencies', 'health_referrals', 'hostel_allocations',
    'library_loans', 'library_reservations', 'marks',
    'medication_administrations', 'report_cards', 'safeguarding_reports',
    'sick_bay_visits', 'student_attendance', 'student_transport_assignments',
    'welfare_concerns', 'whatsapp_conversations'
  ] loop
    if to_regclass(format('public.%I', t)) is null then
      raise exception 'N1: expected table public.% not found', t;
    end if;

    execute format('drop trigger if exists trg_enforce_student_same_school on public.%I', t);
    execute format(
      'create trigger trg_enforce_student_same_school '
      'before insert or update of student_id, school_id on public.%I '
      'for each row execute function public.enforce_student_same_school()', t);
  end loop;
end
$attach$;
