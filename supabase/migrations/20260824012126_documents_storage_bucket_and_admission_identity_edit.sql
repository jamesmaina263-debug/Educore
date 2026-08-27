-- 1. Track which storage bucket each document actually lives in.
--
-- Bug found while building document viewing: every document ever uploaded through the
-- admissions flow (online apply form, staff upload in the wizard, staff upload on the status
-- portal) is written to the 'application-documents' bucket -- and stays there forever, even
-- after complete_enrollment() reassigns the *database row's* student_id and nulls
-- application_id. The student-facing Documents tab (documents-tab.tsx) assumed any document
-- with a student_id belongs in the 'student-documents' bucket and looked there instead --
-- so its "View" button has been generating signed URLs for a bucket the file was never
-- actually in. Verified against every row currently in this table: 100% of them are
-- admission-origin, so backfilling the new column to 'application-documents' is correct for
-- all existing data.
alter table public.documents
  add column storage_bucket text not null default 'application-documents';

comment on column public.documents.storage_bucket is
  'Storage bucket the storage_path lives in. Admission-origin documents (online apply, staff upload in the admissions wizard/status portal) always use application-documents, even after being reassigned to a student on enrollment -- the file itself never moves. Direct student/staff-portal uploads (documents-tab.tsx) use student-documents / staff-documents respectively and must set this explicitly on insert.';

-- 2. Let Admission Officers correct applicant identity (name/DOB/gender) after the Student
-- record has already been created -- the wizard's Step 2 previously only allowed this before
-- createOrLinkStudent ran; afterwards it was locked with no edit path in the wizard at all.
--
-- Single RPC (rather than two separate client-side .update() calls) so the applications row
-- and its linked students row can never drift out of sync with each other, and so this can
-- raise a clear, specific error instead of a generic RLS failure. Both writes ride the
-- existing generic audit_row_change() triggers already on both tables (trg_audit_applications,
-- trg_audit_students) -- no new audit plumbing needed, actor/timestamp/before/after are already
-- captured automatically and visible in Settings > Audit Log.
create or replace function public.update_admission_identity(
  p_application_id uuid,
  p_first_name text,
  p_last_name text,
  p_other_names text,
  p_date_of_birth date,
  p_gender text
) returns void
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_app record;
begin
  if not auth_has_permission('admissions.write') then
    raise exception 'Not authorized to edit admission details.';
  end if;
  if p_first_name is null or btrim(p_first_name) = '' or p_last_name is null or btrim(p_last_name) = '' then
    raise exception 'First name and last name are required.';
  end if;
  if p_date_of_birth is null then
    raise exception 'Date of birth is required.';
  end if;
  if p_gender not in ('male', 'female') then
    raise exception 'Gender must be male or female.';
  end if;

  select * into v_app from public.applications
  where id = p_application_id and school_id = auth_school_id();
  if not found then
    raise exception 'Application not found.';
  end if;

  update public.applications
  set first_name = btrim(p_first_name),
      last_name = btrim(p_last_name),
      other_names = nullif(btrim(coalesce(p_other_names, '')), ''),
      date_of_birth = p_date_of_birth,
      gender = p_gender,
      updated_at = now()
  where id = p_application_id;

  if v_app.resulting_student_id is not null then
    if not auth_has_permission('students.write') then
      raise exception 'Not authorized to edit the linked student record.';
    end if;
    update public.students
    set first_name = btrim(p_first_name),
        last_name = btrim(p_last_name),
        other_names = nullif(btrim(coalesce(p_other_names, '')), ''),
        date_of_birth = p_date_of_birth,
        gender = p_gender
    where id = v_app.resulting_student_id and school_id = v_app.school_id;
  end if;
end;
$$;

revoke all on function public.update_admission_identity(uuid, text, text, text, date, text) from public;
grant execute on function public.update_admission_identity(uuid, text, text, text, date, text) to authenticated;
