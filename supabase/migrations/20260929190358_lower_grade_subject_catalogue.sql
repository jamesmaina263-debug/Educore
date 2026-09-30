-- Adds PP1-Grade 9 subjects to subject_catalogue. Until now, subject_catalogue
-- (20260816112202) held ONLY Senior School (Grade 10-12) pathway subjects --
-- it is the ONLY way any school ever gets a subject at all (activateSubjects
-- only accepts existing catalogue rows; a school can never type a subject
-- name), so no school on this platform could create a Mathematics, English,
-- or any other subject for PP1-Grade 9 until this migration. This was
-- discovered, not introduced, while wiring KICD grounding for those grades
-- (Phase 2B) -- surfacing it and fixing it here rather than quietly working
-- around it.
--
-- Subject lists below are taken directly from KICD's own published
-- curriculum-designs pages (kicd.ac.ke/cbc-materials/lower-primary/,
-- .../curriculum-designs/grade-four-designs/, .../grade-seven-designs/), not
-- from memory or a secondary source. Pre-Primary's list (that KICD page links
-- PDFs per PP1/PP2 without enumerating subjects on the page itself) is the
-- widely corroborated 5 activity areas used consistently across CBC
-- reference material; flagged here as the one band not directly read off an
-- official per-subject listing page, in case it needs correcting later.
--
-- ---------------------------------------------------------------------------
-- Schema change: reframe grade_band as NOT NULL (including a 'senior_school'
-- value for the existing 42 rows) rather than "NULL implies Senior School" --
-- this is what lets uniqueness be scoped to (name, grade_band) below, so
-- "English" can exist once per band without colliding. pathway/category
-- become nullable (Pre-Primary through Junior School genuinely have neither
-- concept); the existing pathway CHECK constraint already tolerates NULL
-- (`NULL IN (...)` doesn't fail a CHECK), so it's left as-is. A new CHECK
-- ties pathway's presence to grade_band = 'senior_school' exactly, so this
-- invariant can't drift: every row is either a Senior School pathway subject
-- (pathway set) or a grade-band subject (pathway null), never an
-- inconsistent mix.
--
-- The application-level consequence is entirely additive: subjects-section.tsx
-- (Academics -> Subjects) keeps its existing Senior-School pathway/category
-- grouping completely untouched (scoped to grade_band = 'senior_school'
-- rows only) and gains a new, separate "By Grade" section for everything
-- else. PATHWAY_ORDER there is an ALLOW-LIST (rows with a pathway outside it
-- are silently invisible), which is exactly why grade-band subjects are
-- never given a pathway value at all, rather than inventing a 5th one.
-- ---------------------------------------------------------------------------

alter table subject_catalogue add column grade_band text;
update subject_catalogue set grade_band = 'senior_school';
alter table subject_catalogue alter column grade_band set not null;
alter table subject_catalogue add constraint subject_catalogue_grade_band_check
  check (grade_band in ('pre_primary', 'lower_primary', 'upper_primary', 'junior_school', 'senior_school'));

alter table subject_catalogue alter column pathway drop not null;
alter table subject_catalogue alter column category drop not null;
alter table subject_catalogue add constraint subject_catalogue_pathway_matches_band
  check ((grade_band = 'senior_school') = (pathway is not null));

alter table subject_catalogue drop constraint subject_catalogue_name_key; -- the old `unique (name)`
alter table subject_catalogue add constraint subject_catalogue_name_grade_band_key unique (name, grade_band);

comment on column subject_catalogue.grade_band is 'pre_primary (PP1-PP2) | lower_primary (G1-3) | upper_primary (G4-6) | junior_school (G7-9) | senior_school (G10-12, the original rows). Determines which section of the Subjects activation UI a row appears in; senior_school rows keep the existing pathway/category grouping, everything else groups by grade_band alone.';

-- ---------------------------------------------------------------------------
-- Pre-Primary (PP1-PP2): 5 activity areas, all compulsory, activity/
-- observation-based (no split by faith at this level).
-- ---------------------------------------------------------------------------
insert into subject_catalogue (grade_band, name, code, is_core, display_order) values
  ('pre_primary', 'Language Activities', 'PP-LANG', true, 0),
  ('pre_primary', 'Mathematical Activities', 'PP-MATH', true, 1),
  ('pre_primary', 'Environmental Activities', 'PP-ENV', true, 2),
  ('pre_primary', 'Psychomotor and Creative Activities', 'PP-PSYC', true, 3),
  ('pre_primary', 'Religious Education Activities', 'PP-RE', true, 4);

-- ---------------------------------------------------------------------------
-- Lower Primary (Grade 1-3). CRE/IRE/HRE are alternative Religious Education
-- options (a learner takes one) -- all three offered, none is_core, so a
-- school activates whichever it actually teaches without the catalogue
-- presuming Christian RE as the default.
-- ---------------------------------------------------------------------------
insert into subject_catalogue (grade_band, name, code, is_core, display_order) values
  ('lower_primary', 'English Activities', 'LP-ENG', true, 0),
  ('lower_primary', 'Kiswahili', 'LP-KIS', true, 1),
  ('lower_primary', 'Mathematics', 'LP-MATH', true, 2),
  ('lower_primary', 'Environmental Activities', 'LP-ENV', true, 3),
  ('lower_primary', 'Creative Activities', 'LP-CRA', true, 4),
  ('lower_primary', 'Indigenous Languages', 'LP-IL', false, 5),
  ('lower_primary', 'CRE', 'LP-CRE', false, 6),
  ('lower_primary', 'IRE', 'LP-IRE', false, 7),
  ('lower_primary', 'HRE', 'LP-HRE', false, 8);

-- ---------------------------------------------------------------------------
-- Upper Primary (Grade 4-6). Foreign/heritage languages (Arabic, French,
-- German, Mandarin, Indigenous Language) are genuine electives, not is_core.
-- ---------------------------------------------------------------------------
insert into subject_catalogue (grade_band, name, code, is_core, display_order) values
  ('upper_primary', 'English', 'UP-ENG', true, 0),
  ('upper_primary', 'Kiswahili', 'UP-KIS', true, 1),
  ('upper_primary', 'Mathematics', 'UP-MATH', true, 2),
  ('upper_primary', 'Science and Technology', 'UP-SCI', true, 3),
  ('upper_primary', 'Social Studies', 'UP-SS', true, 4),
  ('upper_primary', 'Agriculture', 'UP-AGR', true, 5),
  ('upper_primary', 'Creative Arts', 'UP-CA', true, 6),
  ('upper_primary', 'CRE', 'UP-CRE', false, 7),
  ('upper_primary', 'IRE', 'UP-IRE', false, 8),
  ('upper_primary', 'HRE', 'UP-HRE', false, 9),
  ('upper_primary', 'Indigenous Language', 'UP-IL', false, 10),
  ('upper_primary', 'Arabic', 'UP-AR', false, 11),
  ('upper_primary', 'French', 'UP-FR', false, 12),
  ('upper_primary', 'German', 'UP-DE', false, 13),
  ('upper_primary', 'Mandarin', 'UP-ZH', false, 14);

-- ---------------------------------------------------------------------------
-- Junior School (Grade 7-9). Business Studies folded into Pre-Technical
-- Studies in the 2024 rationalisation (per KICD's own site), so it is not
-- listed separately here.
-- ---------------------------------------------------------------------------
insert into subject_catalogue (grade_band, name, code, is_core, display_order) values
  ('junior_school', 'English', 'JS-ENG', true, 0),
  ('junior_school', 'Kiswahili', 'JS-KIS', true, 1),
  ('junior_school', 'Mathematics', 'JS-MATH', true, 2),
  ('junior_school', 'Integrated Science', 'JS-SCI', true, 3),
  ('junior_school', 'Social Studies', 'JS-SS', true, 4),
  ('junior_school', 'Pre-Technical Studies', 'JS-PTS', true, 5),
  ('junior_school', 'Agriculture', 'JS-AGR', true, 6),
  ('junior_school', 'Creative Arts', 'JS-CA', true, 7),
  ('junior_school', 'CRE', 'JS-CRE', false, 8),
  ('junior_school', 'IRE', 'JS-IRE', false, 9),
  ('junior_school', 'HRE', 'JS-HRE', false, 10),
  ('junior_school', 'Indigenous Language', 'JS-IL', false, 11),
  ('junior_school', 'Arabic', 'JS-AR', false, 12),
  ('junior_school', 'French', 'JS-FR', false, 13),
  ('junior_school', 'German', 'JS-DE', false, 14),
  ('junior_school', 'Mandarin', 'JS-ZH', false, 15);
