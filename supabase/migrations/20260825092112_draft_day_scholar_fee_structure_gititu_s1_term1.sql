-- DRAFT, inactive by design: a day-scholar 'core' fee structure did not exist at all for
-- Gititu High School / S.1 / Term 1 (upcoming, id 6cbe8a53-f213-489d-b7a0-5a792adf7b39) --
-- only boarder structures did. This is what left David Wangombe (and Bravin Maina) unable
-- to get an invoice generated at enrollment.
--
-- Cloned from the class-specific boarder structure for the same class/term
-- (1f5900f1-7b21-43bd-8f36-46ad00911eda: S.1, boarder, Tuition 5000), with boarding-only
-- items removed. That structure only carried Tuition (no Accommodation/Caution line), so
-- the clone is Tuition 5000 as-is.
--
-- Left is_active = false intentionally -- fee amounts are a school decision, not something
-- to silently switch on in production. A finance admin should review/adjust the amount(s)
-- in Finance > Fee Structures and flip Active before it will be picked up by invoice
-- generation.
--
-- Note for the reviewer: this school's boarder 'core' structures for this same class/term
-- are inconsistent with each other -- the class-specific one (1f5900f1) and one of the two
-- school-wide/class-null ones (6c07d09b) both show Tuition 5000, but the other class-null
-- one (d8a81df5) shows Accommodation 2500 + Caution 500 + Tuition 5900. Worth a cleanup
-- pass independent of this fix.

with new_structure as (
  insert into public.fee_structures (school_id, academic_year_id, term_id, class_id, boarding_type, name, is_active)
  values (
    '1dea95ea-c9b6-46da-9c07-aba712c84d61',
    '7bd2cabf-1a81-46ae-9e92-bb83d11086ac',
    '6cbe8a53-f213-489d-b7a0-5a792adf7b39',
    'e2c43a15-bf1d-4670-b906-1dca3877f3d8',
    'day',
    'S.1 Day (DRAFT — review amount before activating)',
    false
  )
  returning id
)
insert into public.fee_items (fee_structure_id, name, amount)
select id, 'Tuition', 5000.00 from new_structure;
