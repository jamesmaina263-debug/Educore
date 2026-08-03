
-- Grading scales: one row per configured scale (numeric or CBC), scoped to a school.
create table grading_scales (
  id uuid primary key default gen_random_uuid(),
  school_id uuid not null references schools(id) on delete cascade,
  name text not null,
  model_type text not null check (model_type in ('numeric', 'cbc')),
  is_default boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
comment on table grading_scales is 'A named grading model (numeric/percentage or CBC competency-based) a school can assign at school/class level. model_type is fixed at creation to avoid mixed-meaning bands.';

-- Only one default scale per school (used when a class has no override).
create unique index grading_scales_one_default_per_school
  on grading_scales (school_id) where is_default;

-- Bands: unified shape works for BOTH models —
--   numeric: min_score/max_score/points populated, label = "A", "B+", etc.
--   cbc: min_score/max_score/points left null, label = competency level name (e.g. "Exceeding Expectation"),
--        level_order still defines rank for report-card ordering and any future comparison logic.
create table grading_scale_bands (
  id uuid primary key default gen_random_uuid(),
  grading_scale_id uuid not null references grading_scales(id) on delete cascade,
  label text not null,
  min_score numeric(5,2),
  max_score numeric(5,2),
  points numeric(4,2),
  level_order smallint not null,
  remark text,
  created_at timestamptz not null default now(),
  unique (grading_scale_id, level_order)
);
comment on table grading_scale_bands is 'Ordered bands within a grading scale. For numeric scales, min/max/points are populated and a mark resolves to a band by range. For CBC scales, a teacher selects the band directly (label is the competency level); min/max/points stay null.';

alter table grading_scale_bands enable row level security;
alter table grading_scales enable row level security;

-- Hierarchy: school-level default, overridable per class (grade). No stream-level override —
-- CBC vs numeric is a curriculum-track decision made at grade level, not per parallel stream.
alter table schools add column default_grading_scale_id uuid references grading_scales(id) on delete set null;
alter table classes add column grading_scale_id uuid references grading_scales(id) on delete set null;
comment on column classes.grading_scale_id is 'Overrides schools.default_grading_scale_id for this grade. Null means "use the school default".';
