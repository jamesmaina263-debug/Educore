
create table marks (
  id uuid primary key default gen_random_uuid(),
  school_id uuid not null references schools(id) on delete cascade,
  exam_id uuid not null references exams(id) on delete cascade,
  class_id uuid not null references classes(id) on delete cascade,
  subject_id uuid not null references subjects(id) on delete restrict,
  student_id uuid not null references students(id) on delete cascade,
  raw_score numeric(5,2),
  band_id uuid references grading_scale_bands(id),
  entered_by uuid references school_users(id),
  edit_reason text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (exam_id, student_id, subject_id),
  foreign key (exam_id, class_id, subject_id) references exam_subjects(exam_id, class_id, subject_id) on delete cascade,
  check (raw_score is null or raw_score >= 0)
);
comment on table marks is 'One student''s result for one subject in one exam. Exactly one of raw_score (numeric model) or band_id (CBC model) is populated, per the resolved grading scale for the class — enforced in resolve_mark_band(), not just here, since which one is required depends on the class''s grading model.';

alter table marks enable row level security;

-- Resolves which grading_scale applies to a class (override at class/grade level, else school default),
-- validates/derives the mark against it, and computes band_id. Runs on every insert/update so a mark's
-- band always reflects the scale in effect, even if the scale's bands are edited later.
create or replace function resolve_mark_band() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  v_scale_id uuid;
  v_model text;
  v_max_score numeric;
  v_resolved_band uuid;
begin
  select coalesce(c.grading_scale_id, s.default_grading_scale_id)
    into v_scale_id
  from classes c
  join schools s on s.id = c.school_id
  where c.id = new.class_id;

  if v_scale_id is null then
    raise exception 'No grading scale configured for this class or its school. Configure one under Exams settings first.';
  end if;

  select model_type into v_model from grading_scales where id = v_scale_id;

  select max_score into v_max_score from exam_subjects
    where exam_id = new.exam_id and class_id = new.class_id and subject_id = new.subject_id;

  if v_model = 'numeric' then
    if new.raw_score is null then
      raise exception 'A numeric score is required for this subject.';
    end if;
    if new.raw_score > v_max_score then
      raise exception 'Score % exceeds the max score % for this subject.', new.raw_score, v_max_score;
    end if;
    select id into v_resolved_band from grading_scale_bands
      where grading_scale_id = v_scale_id
        and new.raw_score >= min_score and new.raw_score <= max_score
      limit 1;
    if v_resolved_band is null then
      raise exception 'Score % does not fall within any configured band for this grading scale.', new.raw_score;
    end if;
    new.band_id := v_resolved_band;
  elsif v_model = 'cbc' then
    if new.band_id is null then
      raise exception 'A competency level is required for this subject.';
    end if;
    if not exists (select 1 from grading_scale_bands where id = new.band_id and grading_scale_id = v_scale_id) then
      raise exception 'Selected competency level does not belong to this class''s grading scale.';
    end if;
    new.raw_score := null;
  end if;

  new.updated_at := now();
  return new;
end;
$$;

create trigger marks_resolve_band before insert or update on marks
  for each row execute function resolve_mark_band();

-- Marks lock once the exam is closed, mirroring the attendance rule: no new entries, and any
-- correction to an existing mark requires a non-empty reason (audited via edit_reason, no separate
-- audit_log row since the reason lives on the row itself and marks are already low-volume/high-value).
create or replace function enforce_marks_lock() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  v_status text;
begin
  select status into v_status from exams where id = new.exam_id;
  if v_status = 'closed' then
    if TG_OP = 'INSERT' then
      raise exception 'Cannot add marks to a closed exam. Reopen it first.';
    end if;
    if new.edit_reason is null or btrim(new.edit_reason) = '' then
      raise exception 'Editing a mark on a closed exam requires a reason.';
    end if;
  end if;
  return new;
end;
$$;

create trigger marks_lock before insert or update on marks
  for each row execute function enforce_marks_lock();

-- A teacher's marks.write is scoped to subjects they're assigned to teach, in the student's own
-- stream — same shape as auth_user_is_class_teacher_of_stream, reusing class_subjects.
create or replace function auth_user_teaches_subject_in_stream(p_stream_id uuid, p_subject_id uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1
    from class_subjects cs
    join school_users su on su.id = cs.teacher_id
    where cs.stream_id = p_stream_id
      and cs.subject_id = p_subject_id
      and su.auth_user_id = auth.uid()
      and su.status = 'active'
  );
$$;

create policy marks_select on marks for select
  using (school_id = auth_school_id() and auth_has_permission('exams.read'));

create policy marks_write_own on marks for all
  using (
    school_id = auth_school_id() and auth_has_permission('marks.write')
    and exists (
      select 1 from students st
      where st.id = marks.student_id
        and auth_user_teaches_subject_in_stream(st.current_class_id, marks.subject_id)
    )
  )
  with check (
    school_id = auth_school_id() and auth_has_permission('marks.write')
    and exists (
      select 1 from students st
      where st.id = marks.student_id
        and auth_user_teaches_subject_in_stream(st.current_class_id, marks.subject_id)
    )
  );

create policy marks_write_any on marks for all
  using (school_id = auth_school_id() and auth_has_permission('marks.write_any'))
  with check (school_id = auth_school_id() and auth_has_permission('marks.write_any'));
