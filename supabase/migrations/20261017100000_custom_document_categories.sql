-- Schools can now define their own admission documents (Settings > Admission Documents), e.g.
-- "Immunization Card". Their category keys are generated as custom_<slug>_<suffix>. The existing
-- documents_category_check only allowed a fixed list, so uploads for such documents would fail.
--
-- Backward compatible: every previously-allowed value is still allowed; the new pattern is
-- strict (lowercase letters, digits, underscore only -- no "/" or "..") because the category is
-- used inside storage object paths. Existing rows already satisfy the wider constraint, so it is
-- added NOT VALID (no long lock) and then validated.
alter table public.documents drop constraint documents_category_check;
alter table public.documents add constraint documents_category_check check (
  category = any (array[
    'birth_certificate','id_scan','report_card','transfer_letter','contract',
    'certificate','id_document','licence','qualification','other',
    'previous_report','guardian_id','passport_photo'
  ])
  or category ~ '^custom_[a-z0-9_]{1,60}$'
) not valid;
alter table public.documents validate constraint documents_category_check;
