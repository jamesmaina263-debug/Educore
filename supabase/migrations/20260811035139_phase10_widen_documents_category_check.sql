-- Found via live testing: documents_category_check only knew about the
-- categories used by the student/staff document tabs (birth_certificate,
-- id_scan, report_card, transfer_letter, contract, certificate,
-- id_document, licence, qualification, other). The Phase 10 default
-- application document checklist (application_document_requirements)
-- uses categories that don't all overlap -- 'guardian_id' and
-- 'passport_photo' had no match at all, and inserting either failed
-- outright. 'previous_report' is intentionally kept distinct from the
-- existing 'report_card' (student-owned, post-enrollment) rather than
-- reused for it, since collapsing them would make an application's
-- previous-school report indistinguishable from an enrolled student's
-- in-school report card in any later query.
alter table public.documents drop constraint documents_category_check;
alter table public.documents add constraint documents_category_check check (
  category = any (array[
    'birth_certificate','id_scan','report_card','transfer_letter','contract',
    'certificate','id_document','licence','qualification','other',
    'previous_report','guardian_id','passport_photo'
  ])
);
