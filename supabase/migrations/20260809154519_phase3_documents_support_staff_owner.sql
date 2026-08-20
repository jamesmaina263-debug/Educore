-- Phase 3: generalize the existing single Documents table to also own staff
-- documents (contracts, certificates, IDs, licences) instead of creating a
-- parallel staff_documents table. Student documents are unaffected.

alter table public.documents
  add column if not exists staff_id uuid references public.school_users(id) on delete cascade;

alter table public.documents
  alter column student_id drop not null;

alter table public.documents
  add constraint documents_one_owner_check
  check (
    (student_id is not null and staff_id is null)
    or (student_id is null and staff_id is not null)
  );

create index idx_documents_staff_id on public.documents(staff_id);

-- Widen the category taxonomy to cover staff document types alongside the
-- existing student ones (no separate enum/table per module).
alter table public.documents drop constraint documents_category_check;
alter table public.documents add constraint documents_category_check
  check (category = any (array[
    'birth_certificate', 'id_scan', 'report_card', 'transfer_letter',
    'contract', 'certificate', 'id_document', 'licence', 'qualification',
    'other'
  ]));

drop policy documents_select on public.documents;
create policy documents_select on public.documents
  for select using (
    auth_is_super_admin()
    or (school_id = auth_school_id() and student_id is not null and auth_has_permission('students.documents.read'))
    or (student_id is not null and auth_user_id_is_guardian_of(student_id))
    or (school_id = auth_school_id() and staff_id is not null and auth_has_permission('staff.read'))
    or (staff_id is not null and staff_id = (select id from public.school_users where auth_user_id = auth.uid() and status = 'active'))
  );

drop policy documents_write on public.documents;
create policy documents_write on public.documents
  for all using (
    auth_is_super_admin()
    or (school_id = auth_school_id() and student_id is not null and auth_has_permission('students.documents.write'))
    or (school_id = auth_school_id() and staff_id is not null and auth_has_permission('staff.manage'))
  ) with check (
    auth_is_super_admin()
    or (school_id = auth_school_id() and student_id is not null and auth_has_permission('students.documents.write'))
    or (school_id = auth_school_id() and staff_id is not null and auth_has_permission('staff.manage'))
  );
