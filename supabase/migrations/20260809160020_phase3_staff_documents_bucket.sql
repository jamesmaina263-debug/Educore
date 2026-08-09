-- Mirrors the existing student-documents bucket/policy pattern, scoped to
-- staff.manage/staff.read instead of students.documents.*, plus self-access
-- so a staff member can view (not upload) their own documents.
insert into storage.buckets (id, name, public)
values ('staff-documents', 'staff-documents', false)
on conflict (id) do nothing;

create policy staff_documents_select on storage.objects
  for select using (
    bucket_id = 'staff-documents'
    and (
      auth_is_super_admin()
      or ((storage.foldername(name))[1]::uuid = auth_school_id() and auth_has_permission('staff.read'))
      or (storage.foldername(name))[2]::uuid = (select id from public.school_users where auth_user_id = auth.uid() and status = 'active')
    )
  );

create policy staff_documents_write on storage.objects
  for insert with check (
    bucket_id = 'staff-documents'
    and (
      auth_is_super_admin()
      or ((storage.foldername(name))[1]::uuid = auth_school_id() and auth_has_permission('staff.manage'))
    )
  );

create policy staff_documents_delete on storage.objects
  for delete using (
    bucket_id = 'staff-documents'
    and (
      auth_is_super_admin()
      or ((storage.foldername(name))[1]::uuid = auth_school_id() and auth_has_permission('staff.manage'))
    )
  );
