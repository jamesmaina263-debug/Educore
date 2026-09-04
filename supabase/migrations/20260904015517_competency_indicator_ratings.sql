-- Core-competency / values / PCI appraisal model (Performance Appraisal Engine
-- directive, Step 5). Deliberately a separate table/scale from competency_marks
-- (20260806060917) -- that table records a per-sub-strand ACADEMIC achievement
-- band (EE/ME/AE/BE), tied to a specific exam and subject. This is a holistic,
-- term-level rating (3=Consistently Demonstrates / 2=Developing / 1=Needs
-- Support) of a competency/value/PCI indicator, not tied to any subject or exam.
--
-- Reuses the existing grading engine (grading_scales/grading_scale_bands) for
-- the rating scale itself rather than inventing a parallel int column, so the
-- 3-2-1 scale stays school-configurable exactly like every other grading model
-- in this codebase -- add 'competency' as a third model_type alongside the
-- existing 'numeric'/'cbc'.
--
-- Per the CBC/CBE investigation research on file: KICD does not publish an
-- official rubric scoring VALUES the way sub-strand competencies get one --
-- real CBC treats values as narrative. This table scores them 3-2-1 anyway
-- per explicit product direction, but that's an EduCore-invented convention
-- for the 'value'/'pci' indicator types, not something KNEC will ever consume
-- -- worth keeping in mind for any future KNEC export of this data.

alter table grading_scales drop constraint grading_scales_model_type_check;
alter table grading_scales add constraint grading_scales_model_type_check
  check (model_type in ('numeric', 'cbc', 'competency'));

-- ----------------------------------------------------------------------------
-- 1. Catalog: core competencies, values, PCI areas, and school-authored
--    indicators, all one table distinguished by `type`. Global rows
--    (school_id null) are the real CBC framework, seeded below and editable
--    only by super_admin, same pattern as subject_catalogue (20260816112202).
--    School-authored rows (school_id set) are a school's own additions.
-- ----------------------------------------------------------------------------
create table competency_indicators (
  id uuid primary key default gen_random_uuid(),
  school_id uuid references schools(id) on delete cascade,
  type text not null check (type in ('core_competency', 'value', 'pci', 'school_authored')),
  name text not null,
  description text,
  display_order smallint not null default 0,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (school_id, name)
);
comment on table competency_indicators is 'Catalog of appraisal indicators: CBC core competencies, national values, PCI areas (all global, school_id null, super_admin-owned), plus school_authored rows a school adds itself. type=school_authored requires school_id to be set; the three global types never carry a school_id.';

create trigger trg_competency_indicators_updated_at before update on competency_indicators
  for each row execute function set_updated_at();

alter table competency_indicators add constraint competency_indicators_school_authored_scoping
  check (
    (type = 'school_authored' and school_id is not null)
    or (type <> 'school_authored' and school_id is null)
  );

create index idx_competency_indicators_school on competency_indicators(school_id);

alter table competency_indicators enable row level security;

-- Every authenticated school user can browse the full catalog: global rows plus
-- their own school's school_authored rows.
create policy competency_indicators_select on competency_indicators
  for select to authenticated
  using (school_id is null or (school_id = auth_school_id() and auth_has_permission('academics.read')));

-- Only super_admin manages the global framework rows.
create policy competency_indicators_super_admin_write on competency_indicators
  for all to authenticated
  using (school_id is null and auth_is_super_admin())
  with check (school_id is null and auth_is_super_admin());

-- A school manages its own school_authored rows under the same authority that
-- manages curriculum strands (academics.write).
create policy competency_indicators_school_write on competency_indicators
  for all to authenticated
  using (type = 'school_authored' and school_id = auth_school_id() and auth_has_permission('academics.write'))
  with check (type = 'school_authored' and school_id = auth_school_id() and auth_has_permission('academics.write'));

-- Seed: the real CBC framework. Compiled from public KICD-sourced curriculum
-- reporting as of Sep 2026 -- worth a final cross-check against kicd.ac.ke
-- before this goes in front of real parents, same caveat as subject_catalogue's
-- own seed comment. Values list uses the commonly-cited 8; some sources list
-- only 7 (omitting Social Justice) -- flagged for a final check, not resolved
-- here since seed content review is a product decision, not a schema one.
insert into competency_indicators (type, name, display_order) values
  ('core_competency', 'Communication and Collaboration', 1),
  ('core_competency', 'Critical Thinking and Problem Solving', 2),
  ('core_competency', 'Creativity and Imagination', 3),
  ('core_competency', 'Citizenship', 4),
  ('core_competency', 'Digital Literacy', 5),
  ('core_competency', 'Learning to Learn', 6),
  ('core_competency', 'Self-Efficacy', 7),
  ('value', 'Love', 1),
  ('value', 'Responsibility', 2),
  ('value', 'Respect', 3),
  ('value', 'Unity', 4),
  ('value', 'Peace', 5),
  ('value', 'Patriotism', 6),
  ('value', 'Social Justice', 7),
  ('value', 'Integrity', 8),
  ('pci', 'Citizenship', 1),
  ('pci', 'Health Education', 2),
  ('pci', 'Life Skills and Values Education', 3),
  ('pci', 'Social and Economic Issues', 4);

-- ----------------------------------------------------------------------------
-- 2. Ratings: one per (indicator, student, term). Term-scoped, not exam-scoped
--    -- these are holistic ratings, not tied to a specific sitting. Mirrors
--    competency_marks' own lock-on-close/band-validation trigger shape, but
--    "closed" here means the term itself, not an exam.
-- ----------------------------------------------------------------------------
create table competency_indicator_ratings (
  id uuid primary key default gen_random_uuid(),
  school_id uuid not null references schools(id) on delete cascade,
  indicator_id uuid not null references competency_indicators(id),
  student_id uuid not null references students(id) on delete cascade,
  term_id uuid not null references terms(id),
  band_id uuid not null references grading_scale_bands(id),
  teacher_id uuid references school_users(id),
  observation text check (observation is null or char_length(observation) <= 280),
  edit_reason text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (indicator_id, student_id, term_id)
);
comment on table competency_indicator_ratings is 'One holistic 3-2-1 rating per (indicator, student, term) -- core competency, value, PCI, or school-authored. band_id resolves against the school''s competency-model grading scale, same engine as marks/competency_marks. Not linked to a subject or exam: rated by the student''s class/homeroom teacher, not a subject teacher.';

create index idx_competency_indicator_ratings_student_term on competency_indicator_ratings(student_id, term_id);
create index idx_competency_indicator_ratings_indicator on competency_indicator_ratings(indicator_id);

alter table competency_indicator_ratings enable row level security;

-- Validates band_id against a 'competency' model_type scale resolved for the
-- student's school (school-level default only -- these ratings aren't
-- class/grading-scale-override scoped the way marks are, since they're not
-- subject-linked), and stamps updated_at. Mirrors validate_competency_band().
create or replace function public.validate_competency_indicator_rating_band()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_scale_id uuid;
begin
  select default_grading_scale_id into v_scale_id from schools where id = new.school_id;

  if v_scale_id is null then
    select id into v_scale_id from grading_scales
      where school_id = new.school_id and model_type = 'competency'
      order by is_default desc limit 1;
  end if;

  if v_scale_id is null then
    raise exception 'No competency-model grading scale configured for this school. Configure one under Exams settings first.';
  end if;

  if not exists (select 1 from grading_scale_bands where id = new.band_id and grading_scale_id = v_scale_id) then
    raise exception 'Selected rating does not belong to this school''s competency grading scale.';
  end if;

  new.updated_at := now();
  return new;
end;
$$;

create trigger competency_indicator_ratings_validate_band
  before insert or update on competency_indicator_ratings
  for each row execute function validate_competency_indicator_rating_band();

-- Lock once the term is closed, mirroring marks/competency_marks' exam-close lock.
create or replace function public.enforce_competency_indicator_ratings_lock()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_status text;
begin
  select status into v_status from terms where id = new.term_id;
  if v_status = 'closed' then
    if TG_OP = 'INSERT' then
      raise exception 'Cannot add a competency rating to a closed term. Reopen it first.';
    end if;
    if new.edit_reason is null or btrim(new.edit_reason) = '' then
      raise exception 'Editing a competency rating on a closed term requires a reason.';
    end if;
  end if;
  return new;
end;
$$;

create trigger competency_indicator_ratings_lock
  before insert or update on competency_indicator_ratings
  for each row execute function enforce_competency_indicator_ratings_lock();

-- Trigger functions should never be directly callable as RPCs, same lockdown
-- applied to enforce_competency_marks_lock/validate_competency_band (20260806060942).
revoke execute on function public.validate_competency_indicator_rating_band() from public, anon, authenticated;
revoke execute on function public.enforce_competency_indicator_ratings_lock() from public, anon, authenticated;

-- Select: school staff with the new competency_ratings.read permission, or a
-- guardian/student themselves once a report card for that term/exam context
-- has been released -- mirrors competency_marks_select's shape, but these
-- ratings aren't tied to a single exam_id, so gate on ANY released report
-- card for the student within the same term.
create policy competency_indicator_ratings_select on competency_indicator_ratings
  for select to authenticated
  using (
    (school_id = auth_school_id() and auth_has_permission('competency_ratings.read'))
    or (auth_user_id_is_guardian_of(student_id) and exists (
      select 1 from report_cards rc join exams e on e.id = rc.exam_id
      where rc.student_id = competency_indicator_ratings.student_id
        and e.term_id = competency_indicator_ratings.term_id
        and rc.comment_source in ('teacher_approved', 'teacher_written')
    ))
    or (exists (
      select 1 from students st join school_users su on su.id = st.school_user_id
      where st.id = competency_indicator_ratings.student_id and su.auth_user_id = auth.uid()
    ) and exists (
      select 1 from report_cards rc join exams e on e.id = rc.exam_id
      where rc.student_id = competency_indicator_ratings.student_id
        and e.term_id = competency_indicator_ratings.term_id
        and rc.comment_source in ('teacher_approved', 'teacher_written')
    ))
  );

create policy competency_indicator_ratings_write_any on competency_indicator_ratings
  for all to authenticated
  using (school_id = auth_school_id() and auth_has_permission('competency_ratings.write_any'))
  with check (school_id = auth_school_id() and auth_has_permission('competency_ratings.write_any'));

-- Write (own): scoped to the student's class/homeroom teacher -- these are
-- holistic ratings, not subject-linked, so this reuses
-- auth_user_is_class_teacher_of_stream (20260729114435) against the student's
-- current stream, unlike competency_marks' subject-teacher scoping.
create policy competency_indicator_ratings_write_own on competency_indicator_ratings
  for all to authenticated
  using (
    school_id = auth_school_id() and auth_has_permission('competency_ratings.write')
    and exists (
      select 1 from students st
      where st.id = competency_indicator_ratings.student_id
        and auth_user_is_class_teacher_of_stream(st.current_class_id)
    )
  )
  with check (
    school_id = auth_school_id() and auth_has_permission('competency_ratings.write')
    and exists (
      select 1 from students st
      where st.id = competency_indicator_ratings.student_id
        and auth_user_is_class_teacher_of_stream(st.current_class_id)
    )
  );

-- ----------------------------------------------------------------------------
-- 3. Permissions: new competency_ratings.read/write/write_any, granted to the
--    same populations as the equivalent marks/exams permissions.
-- ----------------------------------------------------------------------------
insert into role_permissions (role_id, school_id, permission_key, allowed)
select r.id, null, p.permission_key, true
from roles r
cross join (values
  ('competency_ratings.read'),
  ('competency_ratings.write'),
  ('competency_ratings.write_any')
) as p(permission_key)
where
  (r.name in ('school_owner', 'principal', 'deputy_principal') and p.permission_key in ('competency_ratings.read', 'competency_ratings.write_any'))
  or (r.name in ('teacher', 'class_teacher') and p.permission_key in ('competency_ratings.read', 'competency_ratings.write'));
-- Deliberately NOT granting 'competency_ratings.read' to parent/student roles:
-- that permission is school-wide (any student), whereas guardian/self access
-- must stay scoped to just their own child -- handled entirely by the
-- separate auth_user_id_is_guardian_of / self-lookup OR-branches in
-- competency_indicator_ratings_select above. Same convention as
-- competency_marks_select (20260806060917), which never grants parents
-- 'exams.read' either.
