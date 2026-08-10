-- Fix: the previous policy's "bucket_id = X and A or B" parsed as
-- "(bucket_id = X and A) or B" due to AND binding tighter than OR — the
-- school-scoped branch had no bucket_id check at all, which would have let
-- admissions.write holders write into ANY storage bucket, not just this
-- one. Caught before this ever reached a client; replacing with correct
-- parentheses.
drop policy application_documents_staff_write on storage.objects;
create policy application_documents_staff_write on storage.objects
  for insert with check (
    bucket_id = 'application-documents'
    and (
      auth_is_super_admin()
      or ((storage.foldername(name))[1]::uuid = auth_school_id() and auth_has_permission('admissions.write'))
    )
  );
