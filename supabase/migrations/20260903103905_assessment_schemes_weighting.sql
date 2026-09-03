-- Performance Appraisal Engine, Step 2: configurable assessment-component weighting.
--
-- Genuine gap confirmed by the Phase 0 audit: exams/exam_subjects/marks are flat -- there is
-- no way for a school to say "Continuous Assessment = 60%, Summative Examination = 40%" and
-- have exams combine into a weighted term score. Deliberately NOT building a duplicate
-- achievement-scale table here -- grading_scales/grading_scale_bands (20260730151424) already
-- fully expresses an 8-level KJSEA-style scale (label/min_score/max_score/points/level_order);
-- that gap closes with a UI preset, not new schema.
--
-- This migration is config only: a named weighting scheme with weighted components, and a
-- nullable exams.component_id tagging which component an exam sitting belongs to. It
-- deliberately does NOT compute a weighted composite score yet -- that combines this,
-- exam_subjects.max_score, and a resolved achievement band, and belongs to a later,
-- separately-tested step once this config layer is proven. Every existing table
-- (exams/exam_subjects/marks/class_rankings/report_cards) is completely untouched --
-- component_id defaults to null, so ungrouped exams behave exactly as before.
--
-- Same shape/precedent as grading_scales/grading_scale_bands: a school-scoped "scheme" wrapper
-- with an is_default flag, and child rows underneath. Written the same way too -- a plain
-- server action doing sequential authenticated writes gated by exams.write (see
-- createGradingScale in exams/actions.ts), not a SECURITY DEFINER function -- there's no
-- cross-tenant invariant here that RLS alone can't already enforce, matching how
-- grading_scales/grading_scale_bands are written today.

create table assessment_schemes (
  id uuid primary key default gen_random_uuid(),
  school_id uuid not null references schools(id) on delete cascade,
  name text not null,
  is_default boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
comment on table assessment_schemes is 'A named, school-configured weighting scheme (e.g. "Continuous Assessment 60% + Summative Exam 40%") -- EduCore-authored configuration, never assumed to be a national KNEC requirement. A term''s exams optionally tag which component of which scheme they belong to (exams.component_id) so they can later be combined into a weighted term score.';

create unique index assessment_schemes_one_default_per_school
  on assessment_schemes (school_id) where is_default;

create trigger trg_assessment_schemes_updated_at
  before update on assessment_schemes
  for each row execute function set_updated_at();

create table assessment_components (
  id uuid primary key default gen_random_uuid(),
  scheme_id uuid not null references assessment_schemes(id) on delete cascade,
  name text not null,
  weight_percent numeric(5,2) not null check (weight_percent > 0 and weight_percent <= 100),
  display_order smallint not null default 0,
  created_at timestamptz not null default now(),
  unique (scheme_id, name)
);
comment on table assessment_components is 'One weighted component of an assessment_schemes row (e.g. "Continuous Assessment", weight_percent=60). Weights are validated to sum to 100 per scheme at the application layer when a scheme is saved (same convention as grading_scale_bands, which also has no DB-level cross-row aggregate constraint) -- not enforced here as a DB constraint since Postgres check constraints cannot reference sibling rows.';

create index idx_assessment_components_scheme on assessment_components(scheme_id);

alter table assessment_schemes enable row level security;
alter table assessment_components enable row level security;

create policy assessment_schemes_select on assessment_schemes for select
  using (school_id = auth_school_id() and auth_has_permission('exams.read'));
create policy assessment_schemes_write on assessment_schemes for all
  using (school_id = auth_school_id() and auth_has_permission('exams.write'))
  with check (school_id = auth_school_id() and auth_has_permission('exams.write'));

create policy assessment_components_select on assessment_components for select
  using (exists (
    select 1 from assessment_schemes s
    where s.id = assessment_components.scheme_id
      and s.school_id = auth_school_id() and auth_has_permission('exams.read')
  ));
create policy assessment_components_write on assessment_components for all
  using (exists (
    select 1 from assessment_schemes s
    where s.id = assessment_components.scheme_id
      and s.school_id = auth_school_id() and auth_has_permission('exams.write')
  ))
  with check (exists (
    select 1 from assessment_schemes s
    where s.id = assessment_components.scheme_id
      and s.school_id = auth_school_id() and auth_has_permission('exams.write')
  ));

-- Tag which weighted component an exam sitting belongs to. Nullable and unindexed-as-required
-- on purpose -- an exam with no component is simply not part of any weighted term composite,
-- exactly today's behavior. No existing query reads this column, so no existing behavior
-- changes by adding it.
alter table exams add column component_id uuid references assessment_components(id) on delete set null;
comment on column exams.component_id is 'Optional: which assessment_components row (within some assessment_schemes) this exam sitting counts toward for a weighted term composite. Null (the default, and every pre-existing exam) means this exam is not part of any weighted composite -- unchanged from today''s per-exam-only behavior.';
