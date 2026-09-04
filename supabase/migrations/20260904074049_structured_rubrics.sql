-- Reconciliation: already live in production (applied 2026-09-04 as version 20260904074049),
-- never committed under this version -- caught by the migration drift check. Content copied
-- verbatim from supabase_migrations.schema_migrations, including its own header comment below,
-- which references a 20260904073925_structured_rubrics.sql that does not actually exist anywhere
-- in this repo's history -- whatever was originally applied under that earlier timestamp appears
-- to have been superseded by this version before ever being committed. Filed verbatim under the
-- timestamp actually recorded in production rather than the referenced-but-missing one, since
-- that's what production's schema_migrations ledger and this repo need to agree on.
--
-- see supabase/migrations/20260904073925_structured_rubrics.sql in the repo for full comments
create table rubrics (
  id uuid primary key default gen_random_uuid(),
  sub_strand_id uuid not null references curriculum_sub_strands(id) on delete cascade unique,
  title text,
  created_by uuid references school_users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
comment on table rubrics is 'A structured rubric for one sub-strand -- one row per sub-strand at most (see unique constraint). Optional/additive alongside curriculum_sub_strands.rubric_text.';

create table rubric_criteria (
  id uuid primary key default gen_random_uuid(),
  rubric_id uuid not null references rubrics(id) on delete cascade,
  name text not null,
  description text,
  display_order smallint not null default 0,
  created_at timestamptz not null default now()
);
comment on table rubric_criteria is 'One scored row within a rubric, e.g. "Uses evidence to support reasoning".';

create index idx_rubric_criteria_rubric on rubric_criteria(rubric_id);

create table rubric_level_descriptors (
  id uuid primary key default gen_random_uuid(),
  criterion_id uuid not null references rubric_criteria(id) on delete cascade,
  band_id uuid not null references grading_scale_bands(id),
  descriptor text not null,
  unique (criterion_id, band_id)
);
comment on table rubric_level_descriptors is 'What a given performance-level band looks like for one criterion, e.g. (criterion="Uses evidence", band=EE) -> "Consistently cites specific evidence to justify conclusions."';

create index idx_rubric_level_descriptors_criterion on rubric_level_descriptors(criterion_id);

create trigger trg_rubrics_updated_at before update on rubrics
  for each row execute function set_updated_at();

alter table rubrics enable row level security;
alter table rubric_criteria enable row level security;
alter table rubric_level_descriptors enable row level security;

create policy rubrics_select on rubrics
  for select to authenticated
  using (exists (
    select 1 from curriculum_sub_strands css
    join curriculum_strands cs on cs.id = css.strand_id
    where css.id = rubrics.sub_strand_id
      and (auth_is_super_admin() or (cs.school_id = auth_school_id() and auth_has_permission('academics.read')))
  ));
create policy rubrics_write on rubrics
  for all to authenticated
  using (exists (
    select 1 from curriculum_sub_strands css
    join curriculum_strands cs on cs.id = css.strand_id
    where css.id = rubrics.sub_strand_id
      and (auth_is_super_admin() or (cs.school_id = auth_school_id() and auth_has_permission('academics.write')))
  ))
  with check (exists (
    select 1 from curriculum_sub_strands css
    join curriculum_strands cs on cs.id = css.strand_id
    where css.id = rubrics.sub_strand_id
      and (auth_is_super_admin() or (cs.school_id = auth_school_id() and auth_has_permission('academics.write')))
  ));

create policy rubric_criteria_select on rubric_criteria
  for select to authenticated
  using (exists (
    select 1 from rubrics r
    join curriculum_sub_strands css on css.id = r.sub_strand_id
    join curriculum_strands cs on cs.id = css.strand_id
    where r.id = rubric_criteria.rubric_id
      and (auth_is_super_admin() or (cs.school_id = auth_school_id() and auth_has_permission('academics.read')))
  ));
create policy rubric_criteria_write on rubric_criteria
  for all to authenticated
  using (exists (
    select 1 from rubrics r
    join curriculum_sub_strands css on css.id = r.sub_strand_id
    join curriculum_strands cs on cs.id = css.strand_id
    where r.id = rubric_criteria.rubric_id
      and (auth_is_super_admin() or (cs.school_id = auth_school_id() and auth_has_permission('academics.write')))
  ))
  with check (exists (
    select 1 from rubrics r
    join curriculum_sub_strands css on css.id = r.sub_strand_id
    join curriculum_strands cs on cs.id = css.strand_id
    where r.id = rubric_criteria.rubric_id
      and (auth_is_super_admin() or (cs.school_id = auth_school_id() and auth_has_permission('academics.write')))
  ));

create policy rubric_level_descriptors_select on rubric_level_descriptors
  for select to authenticated
  using (exists (
    select 1 from rubric_criteria rc
    join rubrics r on r.id = rc.rubric_id
    join curriculum_sub_strands css on css.id = r.sub_strand_id
    join curriculum_strands cs on cs.id = css.strand_id
    where rc.id = rubric_level_descriptors.criterion_id
      and (auth_is_super_admin() or (cs.school_id = auth_school_id() and auth_has_permission('academics.read')))
  ));
create policy rubric_level_descriptors_write on rubric_level_descriptors
  for all to authenticated
  using (exists (
    select 1 from rubric_criteria rc
    join rubrics r on r.id = rc.rubric_id
    join curriculum_sub_strands css on css.id = r.sub_strand_id
    join curriculum_strands cs on cs.id = css.strand_id
    where rc.id = rubric_level_descriptors.criterion_id
      and (auth_is_super_admin() or (cs.school_id = auth_school_id() and auth_has_permission('academics.write')))
  ))
  with check (exists (
    select 1 from rubric_criteria rc
    join rubrics r on r.id = rc.rubric_id
    join curriculum_sub_strands css on css.id = r.sub_strand_id
    join curriculum_strands cs on cs.id = css.strand_id
    where rc.id = rubric_level_descriptors.criterion_id
      and (auth_is_super_admin() or (cs.school_id = auth_school_id() and auth_has_permission('academics.write')))
  ));

create table rubric_criterion_scores (
  id uuid primary key default gen_random_uuid(),
  school_id uuid not null references schools(id),
  competency_mark_id uuid not null references competency_marks(id) on delete cascade,
  criterion_id uuid not null references rubric_criteria(id),
  band_id uuid not null references grading_scale_bands(id),
  feedback text check (feedback is null or char_length(feedback) <= 500),
  entered_by uuid references school_users(id),
  edit_reason text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (competency_mark_id, criterion_id)
);
comment on table rubric_criterion_scores is 'One learner''s score + optional feedback for one rubric criterion, scoped to a specific competency_marks rating. band_id must belong to the same grading scale as the parent competency_mark''s own band -- validated by trigger below.';

create index idx_rubric_criterion_scores_mark on rubric_criterion_scores(competency_mark_id);
create index idx_rubric_criterion_scores_school on rubric_criterion_scores(school_id);

alter table rubric_criterion_scores enable row level security;

create policy rubric_criterion_scores_select on rubric_criterion_scores
  for select to authenticated
  using (
    (school_id = auth_school_id() and auth_has_permission('exams.read'))
    or exists (
      select 1 from competency_marks cm
      where cm.id = rubric_criterion_scores.competency_mark_id
        and (
          (auth_user_id_is_guardian_of(cm.student_id) and exists (
            select 1 from report_cards rc where rc.exam_id = cm.exam_id
              and rc.student_id = cm.student_id
              and rc.comment_source in ('teacher_approved','teacher_written')
          ))
          or (exists (
            select 1 from students st join school_users su on su.id = st.school_user_id
            where st.id = cm.student_id and su.auth_user_id = auth.uid()
          ) and exists (
            select 1 from report_cards rc where rc.exam_id = cm.exam_id
              and rc.student_id = cm.student_id
              and rc.comment_source in ('teacher_approved','teacher_written')
          ))
        )
    )
  );

create policy rubric_criterion_scores_write_any on rubric_criterion_scores
  for all to authenticated
  using (school_id = auth_school_id() and auth_has_permission('marks.write_any'))
  with check (school_id = auth_school_id() and auth_has_permission('marks.write_any'));

create policy rubric_criterion_scores_write_own on rubric_criterion_scores
  for all to authenticated
  using (
    school_id = auth_school_id() and auth_has_permission('marks.write')
    and exists (
      select 1 from competency_marks cm
      join students st on st.id = cm.student_id
      join curriculum_sub_strands css on css.id = cm.sub_strand_id
      join curriculum_strands cst on cst.id = css.strand_id
      where cm.id = rubric_criterion_scores.competency_mark_id
        and auth_user_teaches_subject_in_stream(st.current_class_id, cst.subject_id)
    )
  )
  with check (
    school_id = auth_school_id() and auth_has_permission('marks.write')
    and exists (
      select 1 from competency_marks cm
      join students st on st.id = cm.student_id
      join curriculum_sub_strands css on css.id = cm.sub_strand_id
      join curriculum_strands cst on cst.id = css.strand_id
      where cm.id = rubric_criterion_scores.competency_mark_id
        and auth_user_teaches_subject_in_stream(st.current_class_id, cst.subject_id)
    )
  );

create or replace function public.validate_rubric_criterion_score_band()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_scale_id uuid;
begin
  select gsb.grading_scale_id into v_scale_id
  from competency_marks cm
  join grading_scale_bands gsb on gsb.id = cm.band_id
  where cm.id = new.competency_mark_id;

  if v_scale_id is null then
    raise exception 'Parent competency mark has no resolvable grading scale.';
  end if;

  if not exists (select 1 from grading_scale_bands where id = new.band_id and grading_scale_id = v_scale_id) then
    raise exception 'Selected rubric score does not belong to this class''s grading scale.';
  end if;

  new.updated_at := now();
  return new;
end;
$$;

create trigger rubric_criterion_scores_validate_band
  before insert or update on rubric_criterion_scores
  for each row execute function validate_rubric_criterion_score_band();

create or replace function public.enforce_rubric_criterion_scores_lock()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_status text;
begin
  select e.status into v_status
  from competency_marks cm
  join exams e on e.id = cm.exam_id
  where cm.id = new.competency_mark_id;

  if v_status = 'closed' then
    if TG_OP = 'INSERT' then
      raise exception 'Cannot add a rubric score to a closed exam. Reopen it first.';
    end if;
    if new.edit_reason is null or btrim(new.edit_reason) = '' then
      raise exception 'Editing a rubric score on a closed exam requires a reason.';
    end if;
  end if;
  return new;
end;
$$;

create trigger rubric_criterion_scores_lock
  before insert or update on rubric_criterion_scores
  for each row execute function enforce_rubric_criterion_scores_lock();

revoke execute on function public.validate_rubric_criterion_score_band() from public, anon, authenticated;
revoke execute on function public.enforce_rubric_criterion_scores_lock() from public, anon, authenticated;
