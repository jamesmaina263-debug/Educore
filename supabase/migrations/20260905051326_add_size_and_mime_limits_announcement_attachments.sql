-- Storage audit (Section 10): announcement-attachments was created
-- (20260901034824_announcements_pa08_attachments.sql) with no
-- file_size_limit or allowed_mime_types, unlike every other attachment
-- bucket in the schema (application-documents, assignment-attachments,
-- staff-documents, student-documents, competency-evidence all set both).
-- No client-side or server-side validation exists either (checked
-- src/app/(app)/announcements/actions.ts) -- today a staff member with
-- announcements.publish/manage can attach a file of any type or size.
-- Matching assignment-attachments' limits (same general "staff attaches a
-- document to something school-wide" pattern): 20MB, office/PDF/image/text.

update storage.buckets
set file_size_limit = 20971520,
    allowed_mime_types = array[
      'application/pdf',
      'application/msword',
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      'application/vnd.ms-powerpoint',
      'application/vnd.openxmlformats-officedocument.presentationml.presentation',
      'application/vnd.ms-excel',
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'image/jpeg',
      'image/png',
      'image/webp',
      'text/plain'
    ]
where id = 'announcement-attachments';
