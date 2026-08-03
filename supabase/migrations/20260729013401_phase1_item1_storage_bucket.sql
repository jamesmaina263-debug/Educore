-- Private bucket -- never public. Files are only ever reachable via a
-- server-generated signed URL with a short expiry (Part I), and Storage
-- RLS below mirrors the same tenant/permission/guardian rules as the
-- `documents` metadata table.
insert into storage.buckets (id, name, public)
values ('student-documents', 'student-documents', false)
on conflict (id) do nothing;

-- Objects are keyed as: {school_id}/{student_id}/{document_id}-{filename}
-- so the school_id/student_id are readable straight from the path
-- without a join, keeping these policies simple and fast.
create policy student_documents_select on storage.objects
  for select
  using (
    bucket_id = 'student-documents'
    and (
      auth_is_super_admin()
      or (
        (storage.foldername(name))[1]::uuid = auth_school_id()
        and auth_has_permission('students.documents.read')
      )
      or auth_user_id_is_guardian_of((storage.foldername(name))[2]::uuid)
    )
  );

create policy student_documents_write on storage.objects
  for insert
  with check (
    bucket_id = 'student-documents'
    and (
      auth_is_super_admin()
      or (
        (storage.foldername(name))[1]::uuid = auth_school_id()
        and auth_has_permission('students.documents.write')
      )
    )
  );

create policy student_documents_delete on storage.objects
  for delete
  using (
    bucket_id = 'student-documents'
    and (
      auth_is_super_admin()
      or (
        (storage.foldername(name))[1]::uuid = auth_school_id()
        and auth_has_permission('students.documents.write')
      )
    )
  );
