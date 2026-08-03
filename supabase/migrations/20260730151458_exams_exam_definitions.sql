
create table exams (
  id uuid primary key default gen_random_uuid(),
  school_id uuid not null references schools(id) on delete cascade,
  term_id uuid not null references terms(id) on delete restrict,
  name text not null,
  exam_type text not null check (exam_type in ('cat', 'exam', 'mock', 'other')),
  status text not null default 'open' check (status in ('open', 'closed')),
  closed_at timestamptz,
  closed_by uuid references school_users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
comment on table exams is 'One exam/CAT sitting for a term. Scoped to one or more classes via exam_classes; subjects examined per class via exam_subjects.';

-- Which grades/classes this exam applies to. Streams within a class all sit the same exam definition.
create table exam_classes (
  exam_id uuid not null references exams(id) on delete cascade,
  class_id uuid not null references classes(id) on delete cascade,
  primary key (exam_id, class_id)
);

-- Which subjects are examined, per class, within this exam — and the max score for that subject/exam
-- (some subjects may be weighted differently, e.g. a practical paper out of 50).
create table exam_subjects (
  id uuid primary key default gen_random_uuid(),
  exam_id uuid not null references exams(id) on delete cascade,
  class_id uuid not null references classes(id) on delete cascade,
  subject_id uuid not null references subjects(id) on delete restrict,
  max_score numeric(5,2) not null default 100,
  created_at timestamptz not null default now(),
  unique (exam_id, class_id, subject_id),
  foreign key (exam_id, class_id) references exam_classes(exam_id, class_id) on delete cascade
);

alter table exams enable row level security;
alter table exam_classes enable row level security;
alter table exam_subjects enable row level security;

create policy exams_select on exams for select
  using (school_id = auth_school_id() and auth_has_permission('exams.read'));
create policy exams_write on exams for all
  using (school_id = auth_school_id() and auth_has_permission('exams.write'))
  with check (school_id = auth_school_id() and auth_has_permission('exams.write'));

create policy exam_classes_select on exam_classes for select
  using (exists (select 1 from exams e where e.id = exam_classes.exam_id and e.school_id = auth_school_id() and auth_has_permission('exams.read')));
create policy exam_classes_write on exam_classes for all
  using (exists (select 1 from exams e where e.id = exam_classes.exam_id and e.school_id = auth_school_id() and auth_has_permission('exams.write')))
  with check (exists (select 1 from exams e where e.id = exam_classes.exam_id and e.school_id = auth_school_id() and auth_has_permission('exams.write')));

create policy exam_subjects_select on exam_subjects for select
  using (exists (select 1 from exams e where e.id = exam_subjects.exam_id and e.school_id = auth_school_id() and auth_has_permission('exams.read')));
create policy exam_subjects_write on exam_subjects for all
  using (exists (select 1 from exams e where e.id = exam_subjects.exam_id and e.school_id = auth_school_id() and auth_has_permission('exams.write')))
  with check (exists (select 1 from exams e where e.id = exam_subjects.exam_id and e.school_id = auth_school_id() and auth_has_permission('exams.write')));

-- Structure (which classes/subjects are examined) is locked once the exam is closed — prevents
-- silently changing what a closed exam "was" after rankings/report cards may already reference it.
create or replace function enforce_exam_structure_lock() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  v_exam_id uuid := coalesce(new.exam_id, old.exam_id);
  v_status text;
begin
  select status into v_status from exams where id = v_exam_id;
  if v_status = 'closed' then
    raise exception 'Cannot modify exam structure after the exam is closed.';
  end if;
  return coalesce(new, old);
end;
$$;

create trigger exam_classes_lock before insert or update or delete on exam_classes
  for each row execute function enforce_exam_structure_lock();
create trigger exam_subjects_lock before insert or update or delete on exam_subjects
  for each row execute function enforce_exam_structure_lock();
