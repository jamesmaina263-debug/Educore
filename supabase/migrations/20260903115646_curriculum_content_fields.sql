-- KICD curriculum content fields (CBC/CBE investigation, roadmap Item 1).
--
-- The investigation report flagged an unresolved question: EduCore's own
-- kicd.ac.ke reconnaissance found only a general "All Rights Reserved"
-- notice, no explicit reuse license for KICD's curriculum text. This
-- migration adds ONLY the storage for that content -- nullable fields on
-- curriculum_sub_strands, empty by default, plus a `content_source` flag so
-- it's always visible in the data itself whether an entry is confirmed
-- licensed vs a draft. It does not populate any content: no KICD text is
-- written by this migration or by any app code shipped alongside it.
-- Actually entering real KICD-authored text is a deliberate human action
-- (someone typing/pasting it into the new UI) or a future licensed import --
-- never something generated or fetched automatically.
--
-- Nullable and additive only: existing school-authored strand/sub-strand
-- names (curriculum_strands/curriculum_sub_strands, 20260806060917) are
-- completely untouched.

alter table curriculum_sub_strands
  add column learning_outcomes text,
  add column key_inquiry_questions text,
  add column rubric_text text,
  add column content_source text not null default 'school_authored'
    check (content_source in ('school_authored', 'kicd_licensed', 'draft')),
  add column content_updated_by uuid references school_users(id),
  add column content_updated_at timestamptz;

comment on column curriculum_sub_strands.learning_outcomes is 'Free text. May be school-authored notes or KICD-authored learning outcomes for this sub-strand -- see content_source.';
comment on column curriculum_sub_strands.key_inquiry_questions is 'Free text. Same content_source rule as learning_outcomes.';
comment on column curriculum_sub_strands.rubric_text is 'Free text describing what each competency band looks like for this sub-strand. Same content_source rule as learning_outcomes.';
comment on column curriculum_sub_strands.content_source is 'school_authored (default, always safe): a school wrote this themselves. kicd_licensed: real KICD-authored text, entered only once reuse is confirmed permitted. draft: KICD-style content pasted in before that confirmation -- must not be shown to parents/exported until reclassified.';

-- No RLS changes needed: these columns inherit curriculum_sub_strands' existing
-- policies (curriculum_sub_strands_select / curriculum_sub_strands_write, same
-- migration as the table itself) -- the same academics.write authority that
-- already manages strand/sub-strand names now also manages this content.
