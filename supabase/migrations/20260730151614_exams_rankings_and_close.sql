
-- Snapshot, not a live view — rankings are computed once at exam-close and persist even if a mark
-- is later corrected (a correction doesn't silently reshuffle a published rank; reopening the exam
-- clears the snapshot so it's regenerated on the next close). Numeric-scale classes only: a CBC
-- competency scale has no single averageable number, so ranking doesn't apply there, by design —
-- not a gap, a reflection of the grading model actually chosen for that grade.
create table class_rankings (
  id uuid primary key default gen_random_uuid(),
  exam_id uuid not null references exams(id) on delete cascade,
  class_id uuid not null references classes(id) on delete cascade,
  stream_id uuid not null references streams(id) on delete cascade,
  student_id uuid not null references students(id) on delete cascade,
  total_score numeric(7,2) not null,
  average_score numeric(5,2) not null,
  subjects_counted smallint not null,
  rank_in_stream int not null,
  rank_in_class int not null,
  computed_at timestamptz not null default now(),
  unique (exam_id, student_id)
);

alter table class_rankings enable row level security;

create policy class_rankings_select on class_rankings for select
  using (exists (select 1 from exams e where e.id = class_rankings.exam_id and e.school_id = auth_school_id() and auth_has_permission('exams.read')));

-- No direct write policy: class_rankings is only ever populated by close_exam() (security definer),
-- never by client insert/update/delete.

create or replace function close_exam(p_exam_id uuid) returns void
language plpgsql security definer set search_path = public as $$
declare
  v_school_id uuid := auth_school_id();
  v_caller_id uuid;
begin
  if not auth_has_permission('exams.write') then
    raise exception 'Not authorized to close exams.';
  end if;
  if not exists (select 1 from exams where id = p_exam_id and school_id = v_school_id) then
    raise exception 'Exam not found.';
  end if;

  select id into v_caller_id from school_users where auth_user_id = auth.uid() and status = 'active';

  update exams set status = 'closed', closed_at = now(), closed_by = v_caller_id where id = p_exam_id;

  delete from class_rankings where exam_id = p_exam_id;

  insert into class_rankings (exam_id, class_id, stream_id, student_id, total_score, average_score, subjects_counted, rank_in_stream, rank_in_class)
  select
    p_exam_id,
    m.class_id,
    st.current_class_id,
    m.student_id,
    sum(m.raw_score),
    avg(m.raw_score),
    count(m.raw_score),
    rank() over (partition by st.current_class_id order by avg(m.raw_score) desc),
    rank() over (partition by m.class_id order by avg(m.raw_score) desc)
  from marks m
  join students st on st.id = m.student_id
  join classes c on c.id = m.class_id
  join schools s on s.id = c.school_id
  where m.exam_id = p_exam_id
    and m.raw_score is not null -- numeric-scale marks only; CBC marks have no raw_score to average
  group by m.class_id, st.current_class_id, m.student_id;
end;
$$;

create or replace function reopen_exam(p_exam_id uuid) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not auth_has_permission('exams.write') then
    raise exception 'Not authorized to reopen exams.';
  end if;
  if not exists (select 1 from exams where id = p_exam_id and school_id = auth_school_id()) then
    raise exception 'Exam not found.';
  end if;
  update exams set status = 'open', closed_at = null, closed_by = null where id = p_exam_id;
  delete from class_rankings where exam_id = p_exam_id;
end;
$$;
