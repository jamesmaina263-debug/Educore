-- ============================================================================
-- Subject Catalogue redesign
--
-- Replaces the old model (each school free-typed its own "subjects" rows --
-- live data included duplicates like "Mathematics"/"Core Mathematics"/
-- "Essential Mathematics" and a typo'd "Eglish") with:
--
--   subject_catalogue  -- ONE global, system-wide list of real Kenyan CBC/CBE
--                          Senior School subjects (Pathway -> Category -> Subject),
--                          seeded here, editable only by super_admin (never by a
--                          school), so future curriculum updates land in one place.
--   subjects           -- becomes each SCHOOL's per-subject activation record
--                          against that catalogue (school_id + catalogue_id +
--                          is_active), instead of a free-text row a school typed
--                          in itself.
--
-- subjects.id is left untouched as a stable primary key/FK target -- every
-- downstream table (class_subjects, timetable_slots, exam_subjects, marks,
-- curriculum_strands, assignments) keeps referencing subjects(id) exactly as
-- before, so none of that consuming code needs to change. subjects.name/code/
-- is_core become a denormalized, trigger-locked copy of the catalogue row a
-- school activated, kept for read compatibility with all existing queries.
--
-- Per Lucy's explicit instruction: existing free-typed subjects are discarded,
-- not migrated/mapped. This school (only one exists live, "Demo Academy") had
-- 6 subjects with 66 dependent exam_subjects rows, 1 exam_schedules row, and
-- zero marks/class_subjects/timetable_slots/assignments recorded against them
-- -- confirmed live before writing this migration, so the cascade below
-- discards test/demo data only, not real recorded results.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. Master catalogue -- global, not school-scoped.
-- ----------------------------------------------------------------------------
create table subject_catalogue (
  id uuid primary key default gen_random_uuid(),
  pathway text not null check (pathway in ('Core', 'STEM', 'Social Sciences', 'Arts & Sports Science')),
  category text not null,
  name text not null,
  code text,
  is_core boolean not null default false,
  display_order smallint not null default 0,
  is_active boolean not null default true, -- catalogue-level: lets a future curriculum
                                            -- revision retire a subject without deleting
                                            -- history that already references it.
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (name)
);
create trigger trg_subject_catalogue_updated_at before update on subject_catalogue
  for each row execute function set_updated_at();

alter table subject_catalogue enable row level security;

-- Every authenticated school user, in any school, can browse the catalogue.
create policy subject_catalogue_select on subject_catalogue for select
  to authenticated
  using (true);

-- Only a platform super_admin can add/edit/retire catalogue subjects -- this is
-- the "centralized, future curriculum updates land in one place" requirement.
-- No school-scoped role gets a write policy here at all, so a school cannot
-- insert, edit, or delete a master-catalogue row by any path through the API.
create policy subject_catalogue_super_admin_write on subject_catalogue for all
  to authenticated
  using (auth_is_super_admin())
  with check (auth_is_super_admin());

-- ----------------------------------------------------------------------------
-- 2. Seed: Kenyan CBC/CBE Senior School (Grades 10-12) master subject list.
--    Source: KICD's published Senior School subject list and the three
--    Pathway/Track designs (STEM; Social Sciences; Arts & Sports Science).
--    Compiled from public KICD-sourced curriculum reporting as of Aug 2026 --
--    worth a final cross-check against kicd.ac.ke's own published designs
--    before this goes in front of real parents/exam data, since curriculum
--    detail can be revised.
-- ----------------------------------------------------------------------------
insert into subject_catalogue (pathway, category, name, code, is_core, display_order) values
  -- Core -- compulsory for every learner regardless of pathway
  ('Core', 'Core Subjects', 'English',                        'ENG',   true, 1),
  ('Core', 'Core Subjects', 'Kiswahili',                       'KIS',   true, 2),
  ('Core', 'Core Subjects', 'Kenyan Sign Language',            'KSL',   true, 3),
  ('Core', 'Core Subjects', 'Physical Education',              'PE',    true, 4),
  ('Core', 'Core Subjects', 'Community Service Learning',      'CSL',   true, 5),

  -- STEM -- Pure Sciences
  ('STEM', 'Pure Sciences', 'Mathematics',                     'MATH',  false, 10),
  ('STEM', 'Pure Sciences', 'Advanced Mathematics',             'AMATH', false, 11),
  ('STEM', 'Pure Sciences', 'Biology',                          'BIO',   false, 12),
  ('STEM', 'Pure Sciences', 'Chemistry',                        'CHEM',  false, 13),
  ('STEM', 'Pure Sciences', 'Physics',                          'PHY',   false, 14),
  ('STEM', 'Pure Sciences', 'General Science',                  'GSCI',  false, 15),

  -- STEM -- Applied Sciences
  ('STEM', 'Applied Sciences', 'Agriculture',                   'AGR',   false, 20),
  ('STEM', 'Applied Sciences', 'Computer Studies',               'COMP',  false, 21),
  ('STEM', 'Applied Sciences', 'Home Science',                   'HSC',   false, 22),
  ('STEM', 'Applied Sciences', 'Drawing and Design',             'DRD',   false, 23),

  -- STEM -- Technical Studies
  ('STEM', 'Technical Studies', 'Aviation Technology',           'AVT',   false, 30),
  ('STEM', 'Technical Studies', 'Building and Construction',     'BCT',   false, 31),
  ('STEM', 'Technical Studies', 'Electrical Technology',         'ELT',   false, 32),
  ('STEM', 'Technical Studies', 'Metal Technology',              'MTT',   false, 33),
  ('STEM', 'Technical Studies', 'Power Mechanics',               'PMC',   false, 34),
  ('STEM', 'Technical Studies', 'Wood Technology',                'WDT',   false, 35),
  ('STEM', 'Technical Studies', 'Media Technology',               'MDT',   false, 36),
  ('STEM', 'Technical Studies', 'Marine and Fisheries Technology', 'MFT',  false, 37),

  -- Social Sciences -- Languages & Literature
  ('Social Sciences', 'Languages & Literature', 'Advanced English',        'AENG',  false, 40),
  ('Social Sciences', 'Languages & Literature', 'Literature in English',    'LITE',  false, 41),
  ('Social Sciences', 'Languages & Literature', 'Kiswahili Kipevu',         'KISK',  false, 42),
  ('Social Sciences', 'Languages & Literature', 'Fasihi ya Kiswahili',      'FASK',  false, 43),
  ('Social Sciences', 'Languages & Literature', 'Indigenous Languages',     'INDL',  false, 44),
  ('Social Sciences', 'Languages & Literature', 'Arabic',                  'ARAB',  false, 45),
  ('Social Sciences', 'Languages & Literature', 'French',                  'FRE',   false, 46),
  ('Social Sciences', 'Languages & Literature', 'German',                  'GER',   false, 47),
  ('Social Sciences', 'Languages & Literature', 'Chinese',                 'CHN',   false, 48),

  -- Social Sciences -- Humanities & Business Studies
  ('Social Sciences', 'Humanities & Business Studies', 'History and Citizenship',     'HIST', false, 50),
  ('Social Sciences', 'Humanities & Business Studies', 'Geography',                    'GEO',  false, 51),
  ('Social Sciences', 'Humanities & Business Studies', 'Christian Religious Education', 'CRE',  false, 52),
  ('Social Sciences', 'Humanities & Business Studies', 'Islamic Religious Education',   'IRE',  false, 53),
  ('Social Sciences', 'Humanities & Business Studies', 'Hindu Religious Education',     'HRE',  false, 54),
  ('Social Sciences', 'Humanities & Business Studies', 'Business Studies',              'BST',  false, 55),

  -- Arts & Sports Science -- Sports Science
  ('Arts & Sports Science', 'Sports Science', 'Sports and Recreation',      'SPR',   false, 60),

  -- Arts & Sports Science -- Arts
  ('Arts & Sports Science', 'Arts', 'Music and Dance',                     'MUS',   false, 70),
  ('Arts & Sports Science', 'Arts', 'Theatre and Film',                    'THF',   false, 71),
  ('Arts & Sports Science', 'Arts', 'Fine Arts',                           'FART',  false, 72);

-- ----------------------------------------------------------------------------
-- 3. Discard existing school-typed subjects and everything that depended on
--    them. Explicit and irreversible, per Lucy's instruction -- confirmed live
--    beforehand that only exam_subjects (66 rows, no marks recorded against
--    them) referenced the 6 old subjects; nothing else did.
-- ----------------------------------------------------------------------------
delete from marks;             -- 0 rows live; included for correctness/safety
delete from exam_schedules;    -- 1 row live
delete from exam_subjects;     -- 66 rows live, no marks recorded against them
delete from assignments;       -- 0 rows live
delete from class_subjects;    -- 0 rows live
delete from timetable_slots;   -- 0 rows live
delete from curriculum_strands; -- 0 rows live
delete from subjects;          -- the 6 old free-typed rows

-- ----------------------------------------------------------------------------
-- 4. Re-point subjects at the catalogue: it now represents "this school has
--    activated this catalogue subject", not a free-typed row.
-- ----------------------------------------------------------------------------
alter table subjects drop constraint subjects_school_id_name_key;
alter table subjects add column catalogue_id uuid not null references subject_catalogue(id);
alter table subjects add column is_active boolean not null default true;
alter table subjects add constraint subjects_school_id_catalogue_id_key unique (school_id, catalogue_id);

comment on table subjects is
  'A school''s activated subjects. Each row = one subject_catalogue entry this school has switched on. name/code/is_core are a locked snapshot copied from the catalogue at activation time (see trg_subjects_lock_catalogue_fields) so every existing query reading subjects.name/code/is_core keeps working unchanged. Deactivate via is_active=false, never delete -- see subjects_write policy and the exam_subjects/marks ON DELETE RESTRICT chain.';

-- Only is_active (and updated_at) may change after a subject is activated --
-- catalogue_id/name/code/is_core are a locked snapshot. This is enforced at
-- the database level, not just hidden in the UI, so a school genuinely cannot
-- repoint or rewrite an activated subject, only toggle it on/off.
create or replace function subjects_lock_catalogue_fields() returns trigger
language plpgsql as $$
begin
  if new.catalogue_id is distinct from old.catalogue_id
     or new.name is distinct from old.name
     or new.code is distinct from old.code
     or new.is_core is distinct from old.is_core
     or new.school_id is distinct from old.school_id then
    raise exception 'subjects: only is_active may be changed after activation -- catalogue_id/name/code/is_core/school_id are locked to the master catalogue';
  end if;
  return new;
end;
$$;
create trigger trg_subjects_lock_catalogue_fields before update on subjects
  for each row execute function subjects_lock_catalogue_fields();

-- No DELETE policy is defined for subjects (below) -- deactivate, don't delete.
drop policy subjects_write on subjects;
create policy subjects_insert on subjects for insert
  to authenticated
  with check (auth_is_super_admin() or (school_id = auth_school_id() and auth_has_permission('academics.write')));
create policy subjects_update on subjects for update
  to authenticated
  using (auth_is_super_admin() or (school_id = auth_school_id() and auth_has_permission('academics.write')))
  with check (auth_is_super_admin() or (school_id = auth_school_id() and auth_has_permission('academics.write')));
