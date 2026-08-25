-- The admission-form merge output (a filled .docx, uploaded to this same bucket under
-- {school_id}/{application_id}/...) was always going to fail here -- this bucket only ever
-- allowed application/pdf, image/jpeg, image/png, image/webp (applicant-submitted verification
-- documents: ID copies, birth certs, KCPE slips). Confirmed via live runtime error logs
-- (Vercel:get_runtime_errors), not guessed: "mime type application/vnd.openxmlformats-
-- officedocument.wordprocessingml.document is not supported", thrown at the storage.upload()
-- call in sendAdmissionFormEmail on Patrick Kiama's real acceptance (APP-2026-00036).
-- Checked the new document-preview-dialog.tsx (added by a concurrent session) before widening
-- this -- it already degrades gracefully to "open in a new tab" for any non-PDF/image file, so
-- adding docx here doesn't break that inline-preview feature.
update storage.buckets
set allowed_mime_types = array_append(
  allowed_mime_types,
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
)
where id = 'application-documents'
  and not ('application/vnd.openxmlformats-officedocument.wordprocessingml.document' = any(allowed_mime_types));
