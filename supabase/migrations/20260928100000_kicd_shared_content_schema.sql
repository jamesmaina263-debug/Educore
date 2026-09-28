-- Phase 2B, PR 1 of 3: schema for EduCore-wide (shared) KICD curriculum
-- content, plus the per-class grade setting needed to know WHICH shared
-- content applies to a class. NO KICD CONTENT IS LOADED BY THIS MIGRATION
-- and nothing reads these tables yet (PR 2: platform-admin import tool;
-- PR 3: grounding merge in buildCurriculumContext). Until PR 3, behaviour
-- of every existing feature is unchanged.
--
-- Licensing (see 20260903115646_curriculum_content_fields.sql): the project
-- owner has confirmed EduCore holds the right to store and distribute KICD
-- curriculum content. Because the scope/terms of that licence aren't encoded
-- anywhere in code, every content batch must carry a licence_reference +
-- attribution (NOT NULL below) so the basis for any KICD row is auditable,
-- and every source has is_enabled -- a single-row kill switch that hides all
-- of its content from every school at once if terms change or are withdrawn.
--
-- Why classes.kicd_grade: classes have no reliable grade field (level_order
-- collides across naming schemes: "Grade 1", "Play Group" and "S.1" are all
-- 1), and inferring grade from free-text names would risk silently grounding
-- a scheme in the wrong grade's content. So it is an explicit, nullable,
-- school-confirmed setting; NULL means "no KICD grounding for this class"
-- (fail closed).

alter table classes
  add column kicd_grade text
  check (kicd_grade in ('PP1','PP2','G1','G2','G3','G4','G5','G6','G7','G8','G9','G10','G11','G12'));
comment on column classes.kicd_grade is 'School-confirmed KICD grade for this class (PP1, PP2, G1..G12). NULL = not set: the class receives no shared KICD grounding. Never inferred from the class name.';

create table kicd_content_sources (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  licence_reference text not null,
  licence_scope text,
  attribution text not null,
  source_document text,
  is_enabled boolean not null default true,
  created_by uuid references school_users(id),
  created_at timestamptz not null default now()
);
comment on table kicd_content_sources is 'One row per licensed KICD source document/batch. licence_reference and attribution are mandatory so every shared row is traceable to the basis for using it. is_enabled=false withdraws all of the source''s content from every school immediately (kill switch).';

create table kicd_learning_areas (
  id uuid primary key default gen_random_uuid(),
  name text not null unique,
  catalogue_id uuid references subject_catalogue(id),
  display_order smallint not null default 0,
  created_at timestamptz not null default now()
);
comment on table kicd_learning_areas is 'KICD learning areas, mapped where possible to the platform subject_catalogue (subjects.catalogue_id) so a school subject can be matched to shared content. catalogue_id is null for learning areas the catalogue does not yet contain.';

create table kicd_strands (
  id uuid primary key default gen_random_uuid(),
  source_id uuid not null references kicd_content_sources(id),
  learning_area_id uuid not null references kicd_learning_areas(id),
  grade text not null check (grade in ('PP1','PP2','G1','G2','G3','G4','G5','G6','G7','G8','G9','G10','G11','G12')),
  name text not null,
  level_order smallint not null default 0,
  created_at timestamptz not null default now(),
  unique (source_id, learning_area_id, grade, name)
);
create index idx_kicd_strands_lookup on kicd_strands(learning_area_id, grade);

create table kicd_sub_strands (
  id uuid primary key default gen_random_uuid(),
  strand_id uuid not null references kicd_strands(id) on delete cascade,
  name text not null,
  level_order smallint not null default 0,
  learning_outcomes text,
  key_inquiry_questions text,
  rubric_text text,
  created_at timestamptz not null default now(),
  unique (strand_id, name)
);
create index idx_kicd_sub_strands_strand on kicd_sub_strands(strand_id);

alter table kicd_content_sources enable row level security;
alter table kicd_learning_areas enable row level security;
alter table kicd_strands enable row level security;
alter table kicd_sub_strands enable row level security;

-- Read: any signed-in user, but only content whose source is enabled
-- (platform admins see everything, including disabled sources).
create policy kicd_content_sources_select on kicd_content_sources
  for select to authenticated using (is_enabled or auth_is_super_admin());
create policy kicd_learning_areas_select on kicd_learning_areas
  for select to authenticated using (true);
create policy kicd_strands_select on kicd_strands
  for select to authenticated using (
    auth_is_super_admin()
    or exists (select 1 from kicd_content_sources s where s.id = kicd_strands.source_id and s.is_enabled)
  );
create policy kicd_sub_strands_select on kicd_sub_strands
  for select to authenticated using (
    exists (select 1 from kicd_strands k where k.id = kicd_sub_strands.strand_id)
  );

-- Write: platform admins only. No school role can create, edit or delete
-- shared content, whatever permissions it holds.
create policy kicd_content_sources_write on kicd_content_sources
  for all to authenticated using (auth_is_super_admin()) with check (auth_is_super_admin());
create policy kicd_learning_areas_write on kicd_learning_areas
  for all to authenticated using (auth_is_super_admin()) with check (auth_is_super_admin());
create policy kicd_strands_write on kicd_strands
  for all to authenticated using (auth_is_super_admin()) with check (auth_is_super_admin());
create policy kicd_sub_strands_write on kicd_sub_strands
  for all to authenticated using (auth_is_super_admin()) with check (auth_is_super_admin());
