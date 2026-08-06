-- CBC curriculum modeling (Gap Analysis Tier 2 #7). The existing `marks`
-- table already supports competency grading (Phase 2: model_type='cbc'
-- classes record a band_id like EE/ME/AE/BE instead of a raw_score) — but
-- only at the whole-subject level per exam. Real Kenyan CBC assesses each
-- Learning Area (subject) broken into Strands, each broken into
-- Sub-Strands, with a competency level recorded per sub-strand. That finer
-- granularity is the actual gap; this migration adds it as a parallel,
-- more granular layer alongside the existing subject-level `marks` table,
-- rather than rewriting it — schools using plain numeric or whole-subject
-- CBC grading are completely unaffected.
create table curriculum_strands (
  id uuid primary key default gen_random_uuid(),
  school_id uuid not null references schools(id),
  subject_id uuid not null references subjects(id),
  name text not null,
  level_order smallint not null default 0,
  created_at timestamptz not null default now()
);
comment on table curriculum_strands is 'A CBC Learning Area (subject) broken into strands, e.g. English -> "Listening and Speaking". School-defined, not pre-seeded with KICD content — curriculum content curation is out of scope here, this ships the framework.';

create table curriculum_sub_strands (
  id uuid primary key default gen_random_uuid(),
  strand_id uuid not null references curriculum_strands(id) on delete cascade,
  name text not null,
  level_order smallint not null default 0,
  created_at timestamptz not null default now()
);
comment on table curriculum_sub_strands is 'The actual unit of CBC competency assessment — a rating is recorded per sub-strand, not per subject.';

create index idx_curriculum_strands_subject on curriculum_strands(subject_id);
create index idx_curriculum_sub_strands_strand on curriculum_sub_strands(strand_id);

alter table curriculum_strands enable row level security;
alter table curriculum_sub_strands enable row level security;

create policy curriculum_strands_select on curriculum_strands
  for select to authenticated
  using (auth_is_super_admin() or (school_id = auth_school_id() and auth_has_permission('academics.read')));
create policy curriculum_strands_write on curriculum_strands
  for all to authenticated
  using (auth_is_super_admin() or (school_id = auth_school_id() and auth_has_permission('academics.write')))
  with check (auth_is_super_admin() or (school_id = auth_school_id() and auth_has_permission('academics.write')));

create policy curriculum_sub_strands_select on curriculum_sub_strands
  for select to authenticated
  using (exists (
    select 1 from curriculum_strands cs
    where cs.id = curriculum_sub_strands.strand_id
      and (auth_is_super_admin() or (cs.school_id = auth_school_id() and auth_has_permission('academics.read')))
  ));
create policy curriculum_sub_strands_write on curriculum_sub_strands
  for all to authenticated
  using (exists (
    select 1 from curriculum_strands cs
    where cs.id = curriculum_sub_strands.strand_id
      and (auth_is_super_admin() or (cs.school_id = auth_school_id() and auth_has_permission('academics.write')))
  ))
  with check (exists (
    select 1 from curriculum_strands cs
    where cs.id = curriculum_sub_strands.strand_id
      and (auth_is_super_admin() or (cs.school_id = auth_school_id() and auth_has_permission('academics.write')))
  ));

-- Sub-strand-level competency assessment: one rating per (exam, student,
-- sub_strand). Mirrors marks' own/write_any split and lock-on-close/band-
-- validation triggers exactly, since it's the same authority and workflow
-- shape, just a finer grain.
create table competency_marks (
  id uuid primary key default gen_random_uuid(),
  school_id uuid not null references schools(id),
  exam_id uuid not null references exams(id),
  class_id uuid not null references classes(id),
  student_id uuid not null references students(id),
  sub_strand_id uuid not null references curriculum_sub_strands(id),
  band_id uuid not null references grading_scale_bands(id),
  entered_by uuid references school_users(id),
  edit_reason text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (exam_id, student_id, sub_strand_id)
);
comment on table competency_marks is 'Sub-strand-level CBC competency ratings, one per (exam, student, sub_strand) — the finer-grained sibling of subject-level marks.band_id for CBC classes.';

create index idx_competency_marks_exam_student on competency_marks(exam_id, student_id);

alter table competency_marks enable row level security;

create policy competency_marks_select on competency_marks
  for select to authenticated
  using (
    (school_id = auth_school_id() and auth_has_permission('exams.read'))
    or (auth_user_id_is_guardian_of(student_id) and exists (
      select 1 from report_cards rc where rc.exam_id = competency_marks.exam_id
        and rc.student_id = competency_marks.student_id
        and rc.comment_source in ('teacher_approved','teacher_written')
    ))
    or (exists (
      select 1 from students st join school_users su on su.id = st.school_user_id
      where st.id = competency_marks.student_id and su.auth_user_id = auth.uid()
    ) and exists (
      select 1 from report_cards rc where rc.exam_id = competency_marks.exam_id
        and rc.student_id = competency_marks.student_id
        and rc.comment_source in ('teacher_approved','teacher_written')
    ))
  );

create policy competency_marks_write_any on competency_marks
  for all to authenticated
  using (school_id = auth_school_id() and auth_has_permission('marks.write_any'))
  with check (school_id = auth_school_id() and auth_has_permission('marks.write_any'));

create policy competency_marks_write_own on competency_marks
  for all to authenticated
  using (
    school_id = auth_school_id() and auth_has_permission('marks.write')
    and exists (
      select 1 from students st
      join curriculum_sub_strands css on css.id = competency_marks.sub_strand_id
      join curriculum_strands cst on cst.id = css.strand_id
      where st.id = competency_marks.student_id
        and auth_user_teaches_subject_in_stream(st.current_class_id, cst.subject_id)
    )
  )
  with check (
    school_id = auth_school_id() and auth_has_permission('marks.write')
    and exists (
      select 1 from students st
      join curriculum_sub_strands css on css.id = competency_marks.sub_strand_id
      join curriculum_strands cst on cst.id = css.strand_id
      where st.id = competency_marks.student_id
        and auth_user_teaches_subject_in_stream(st.current_class_id, cst.subject_id)
    )
  );

create or replace function public.enforce_competency_marks_lock()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_status text;
begin
  select status into v_status from exams where id = new.exam_id;
  if v_status = 'closed' then
    if TG_OP = 'INSERT' then
      raise exception 'Cannot add competency marks to a closed exam. Reopen it first.';
    end if;
    if new.edit_reason is null or btrim(new.edit_reason) = '' then
      raise exception 'Editing a competency mark on a closed exam requires a reason.';
    end if;
  end if;
  return new;
end;
$$;

create or replace function public.validate_competency_band()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_scale_id uuid;
  v_model text;
begin
  select coalesce(
    c.grading_scale_id,
    (select gs.id from grading_scales gs where gs.school_id = c.school_id and gs.is_default limit 1)
  ) into v_scale_id
  from classes c
  where c.id = new.class_id;

  if v_scale_id is null then
    raise exception 'No grading scale configured for this class or its school.';
  end if;

  select model_type into v_model from grading_scales where id = v_scale_id;
  if v_model <> 'cbc' then
    raise exception 'Sub-strand competency marks only apply to CBC-model classes.';
  end if;

  if not exists (select 1 from grading_scale_bands where id = new.band_id and grading_scale_id = v_scale_id) then
    raise exception 'Selected competency level does not belong to this class''s grading scale.';
  end if;

  new.updated_at := now();
  return new;
end;
$$;

create trigger competency_marks_lock
  before insert or update on competency_marks
  for each row execute function enforce_competency_marks_lock();

create trigger competency_marks_validate_band
  before insert or update on competency_marks
  for each row execute function validate_competency_band();
