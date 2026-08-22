-- Feature: school_owner/principal should be able to permanently delete a student. There is
-- currently no DELETE policy on students at all -- nobody can delete one today, even by
-- mistake. A plain DELETE would also fail outright for any student with real history: 24
-- tables reference students with ON DELETE NO ACTION (attendance, exam marks, discipline,
-- health, safeguarding, library, NEMIS sync, fees, etc. -- versus ~16 that already cascade),
-- so those need to be purged explicitly, in dependency order, before the student row itself
-- can go.
--
-- Safety net: since this is irreversible, a full snapshot of the student (plus how many rows
-- existed in each related table) is written to audit_log *before* anything is deleted, so
-- there is always a forensic record of who deleted what and when, even though the row itself
-- is gone. This mirrors the existing set_student_status / complete_enrollment pattern of
-- writing to audit_log inside the same SECURITY DEFINER transaction.
--
-- Scope decision: applications.resulting_student_id is nullable and NO ACTION -- rather than
-- deleting the original application (a parent's submission, independent of whether a student
-- record still exists), it's detached (set to null) so the application itself survives as a
-- historical record.

insert into public.role_permissions (role_id, school_id, permission_key, allowed)
select r.id, null, 'students.delete', true
from public.roles r
where r.name in ('school_owner', 'principal')
on conflict do nothing;

create or replace function public.delete_student_permanently(p_student_id uuid, p_reason text default null)
returns void
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_school_id uuid;
  v_actor uuid;
  v_snapshot jsonb;
begin
  if not auth_has_permission('students.delete') then
    raise exception 'Not authorized to permanently delete a student.';
  end if;

  select school_id into v_school_id
  from public.students
  where id = p_student_id and school_id = auth_school_id()
  for update;
  if not found then
    raise exception 'Student not found.';
  end if;

  v_actor := auth_school_user_id();

  -- Snapshot the student plus related-record counts before anything is touched, so the
  -- audit_log entry is a real forensic record of what existed, not just an "it happened" flag.
  select to_jsonb(s.*) || jsonb_build_object(
    'reason', p_reason,
    'related_record_counts', jsonb_build_object(
      'admission_enrollment_history', (select count(*) from public.admission_enrollment_history where student_id = p_student_id),
      'assignment_submissions', (select count(*) from public.assignment_submissions where student_id = p_student_id),
      'certificates', (select count(*) from public.certificates where student_id = p_student_id),
      'competency_marks', (select count(*) from public.competency_marks where student_id = p_student_id),
      'disciplinary_actions', (select count(*) from public.disciplinary_actions where student_id = p_student_id),
      'discipline_cases', (select count(*) from public.discipline_cases where student_id = p_student_id),
      'discipline_records', (select count(*) from public.discipline_records where student_id = p_student_id),
      'fee_waivers', (select count(*) from public.fee_waivers where student_id = p_student_id),
      'health_emergencies', (select count(*) from public.health_emergencies where student_id = p_student_id),
      'health_referrals', (select count(*) from public.health_referrals where student_id = p_student_id),
      'hostel_allocations', (select count(*) from public.hostel_allocations where student_id = p_student_id),
      'library_loans', (select count(*) from public.library_loans where student_id = p_student_id),
      'library_reservations', (select count(*) from public.library_reservations where student_id = p_student_id),
      'medication_administrations', (select count(*) from public.medication_administrations where student_id = p_student_id),
      'mpesa_stk_requests', (select count(*) from public.mpesa_stk_requests where student_id = p_student_id),
      'nemis_sync_batch_students', (select count(*) from public.nemis_sync_batch_students where student_id = p_student_id),
      'pt_meeting_bookings', (select count(*) from public.pt_meeting_bookings where student_id = p_student_id),
      'safeguarding_reports', (select count(*) from public.safeguarding_reports where student_id = p_student_id),
      'sick_bay_visits', (select count(*) from public.sick_bay_visits where student_id = p_student_id),
      'student_attendance', (select count(*) from public.student_attendance where student_id = p_student_id),
      'student_promotion_history', (select count(*) from public.student_promotion_history where student_id = p_student_id),
      'student_transport_assignments', (select count(*) from public.student_transport_assignments where student_id = p_student_id),
      'welfare_concerns', (select count(*) from public.welfare_concerns where student_id = p_student_id),
      'applications_detached', (select count(*) from public.applications where resulting_student_id = p_student_id)
    )
  ) into v_snapshot
  from public.students s
  where s.id = p_student_id;

  insert into public.audit_log (school_id, actor_school_user_id, table_name, record_id, action, old_data)
  values (v_school_id, v_actor, 'students', p_student_id, 'permanent_delete', v_snapshot);

  -- Detach (don't delete) the original application -- it's the parent's historical
  -- submission, independent of whether a student record still exists for it.
  update public.applications set resulting_student_id = null where resulting_student_id = p_student_id;

  -- Children-of-children first (discipline has its own internal FK chain).
  delete from public.disciplinary_actions where student_id = p_student_id;
  delete from public.discipline_records where student_id = p_student_id;
  delete from public.discipline_cases where student_id = p_student_id;

  delete from public.admission_enrollment_history where student_id = p_student_id;
  delete from public.assignment_submissions where student_id = p_student_id;
  delete from public.certificates where student_id = p_student_id;
  delete from public.competency_marks where student_id = p_student_id;
  delete from public.fee_waivers where student_id = p_student_id;
  delete from public.health_emergencies where student_id = p_student_id;
  delete from public.health_referrals where student_id = p_student_id;
  delete from public.hostel_allocations where student_id = p_student_id;
  delete from public.library_loans where student_id = p_student_id;
  delete from public.library_reservations where student_id = p_student_id;
  delete from public.medication_administrations where student_id = p_student_id;
  delete from public.mpesa_stk_requests where student_id = p_student_id;
  delete from public.nemis_sync_batch_students where student_id = p_student_id;
  delete from public.pt_meeting_bookings where student_id = p_student_id;
  delete from public.safeguarding_reports where student_id = p_student_id;
  delete from public.sick_bay_visits where student_id = p_student_id;
  delete from public.student_attendance where student_id = p_student_id;
  delete from public.student_promotion_history where student_id = p_student_id;
  delete from public.student_transport_assignments where student_id = p_student_id;
  delete from public.welfare_concerns where student_id = p_student_id;

  -- Everything else referencing students (boarding_incidents, boarding_transfers,
  -- class_rankings, discounts, document_access_log, documents, fee_threshold_alerts,
  -- invoices, marks, medical_records, payments, receipts, report_cards,
  -- student_financial_accounts, student_guardians, student_risk_scores) is ON DELETE CASCADE
  -- and is cleaned up automatically by this final delete.
  delete from public.students where id = p_student_id;
end;
$$;

comment on function public.delete_student_permanently is
  'Irreversibly deletes a student and every related record (attendance, exams, discipline, health, safeguarding, library, fees, etc). Restricted to students.delete (school_owner/principal by default). Writes a full snapshot to audit_log before deleting anything, and detaches (does not delete) the originating application. Direct DELETE on students is not supported -- 24 related tables use ON DELETE NO ACTION and must be purged explicitly in dependency order, which only this function does.';

revoke all on function public.delete_student_permanently(uuid, text) from public;
grant execute on function public.delete_student_permanently(uuid, text) to authenticated;
