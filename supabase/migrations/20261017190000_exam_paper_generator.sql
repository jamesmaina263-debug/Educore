-- Exam paper generator (AI-drafted question papers grounded in curriculum).
--
-- ADDITIVE ONLY. This migration adds new tables for generated papers and
-- their questions, plus one new permission. It does NOT touch any existing
-- curriculum table (curriculum_strands / curriculum_sub_strands /
-- curriculum_extraction_batches / kicd_*), any exam/marks table, or any
-- existing policy. Curriculum content is only ever READ by the generator;
-- there is no new upload path, no new ingestion pipeline and no copy of
-- curriculum content other than the per-paper attribution snapshot below.
--
-- Source attribution: every paper records WHICH single curriculum source it
-- was generated from (platform KICD, this school's own KICD import, or the
-- school's own authored curriculum), the licence reference + attribution
-- text of a KICD source as they were at generation time, and a snapshot of
-- the exact sub-strands used. Curriculum rows have no version column, so
-- this snapshot is the only version information that can be kept.

insert into role_permissions (role_id, permission_key, allowed)
select id, 'exams.generate_paper_ai', true
from roles where name in ('teacher','class_teacher','school_owner','principal','deputy_principal');

create table exam_papers (
  id uuid primary key default gen_random_uuid(),
  school_id uuid not null references schools(id) on delete cascade,
  subject_id uuid not null references subjects(id) on delete restrict,
  class_id uuid not null references classes(id) on delete restrict,
  exam_id uuid references exams(id) on delete set null,
  title text not null,
  status text not null default 'draft' check (status in ('draft', 'approved')),
  total_marks numeric(6,2) not null default 0,
  source_kind text not null check (source_kind in ('platform_kicd', 'school_kicd', 'school_authored')),
  source_id uuid references kicd_content_sources(id) on delete set null,
  source_name text not null,
  source_licence_reference text,
  source_attribution text,
  source_snapshot jsonb not null default '[]'::jsonb,
  prompt_version text not null,
  created_by uuid references school_users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
comment on table exam_papers is 'AI-drafted exam paper. One paper uses exactly one curriculum source (source_kind) -- sources are never mixed. source_snapshot records the sub-strands used; source_licence_reference/source_attribution copy the KICD source terms at generation time. Always starts as a draft for a teacher to review.';
comment on column exam_papers.source_snapshot is 'JSON array of {ref, strand, sub_strand, content_source, content_updated_at} for each sub-strand the paper was generated from.';

create index idx_exam_papers_school on exam_papers (school_id);
create index idx_exam_papers_subject_class on exam_papers (subject_id, class_id);
create index idx_exam_papers_exam on exam_papers (exam_id) where exam_id is not null;

create trigger trg_exam_papers_updated_at
  before update on exam_papers
  for each row execute function set_updated_at();

create table exam_paper_questions (
  id uuid primary key default gen_random_uuid(),
  paper_id uuid not null references exam_papers(id) on delete cascade,
  position smallint not null check (position > 0),
  question_type text not null check (question_type in ('multiple_choice', 'short_answer', 'structured', 'essay')),
  question_text text not null,
  marks numeric(5,2) not null check (marks > 0),
  marking_scheme text not null,
  sub_strand_ref text not null,
  sub_strand_label text not null,
  created_at timestamptz not null default now(),
  unique (paper_id, position)
);
comment on table exam_paper_questions is 'One question of an exam_papers row, labelled with the sub-strand (sub_strand_label, and sub_strand_ref = id of the source row) it assesses.';
create index idx_exam_paper_questions_paper on exam_paper_questions (paper_id);

create table exam_paper_ai_requests (
  id uuid primary key default gen_random_uuid(),
  school_id uuid not null references schools(id) on delete cascade,
  paper_id uuid references exam_papers(id) on delete set null,
  requested_by uuid not null references school_users(id),
  idempotency_key uuid not null,
  prompt_version text not null,
  status text not null default 'pending' check (status in ('pending', 'succeeded', 'failed')),
  failure_category text,
  duration_ms integer,
  created_at timestamptz not null default now(),
  completed_at timestamptz,
  unique (requested_by, idempotency_key)
);
comment on table exam_paper_ai_requests is 'Audit + idempotency log for exam paper generation calls, same purpose and shape as scheme_of_work_ai_requests.';
create index idx_exam_paper_ai_requests_school on exam_paper_ai_requests (school_id);

alter table exam_papers enable row level security;
alter table exam_paper_questions enable row level security;
alter table exam_paper_ai_requests enable row level security;

-- Read: exams.read holders in the school, or the paper's own creator.
create policy exam_papers_select on exam_papers for select to authenticated
  using (
    auth_is_super_admin()
    or (school_id = (select auth_school_id()) and (auth_has_permission('exams.read') or created_by = (select auth_school_user_id())))
  );

-- Write: exams.write holders, or a generate_paper_ai holder for their OWN papers.
create policy exam_papers_insert on exam_papers for insert to authenticated
  with check (
    school_id = (select auth_school_id())
    and (auth_has_permission('exams.write') or (auth_has_permission('exams.generate_paper_ai') and created_by = (select auth_school_user_id())))
  );
create policy exam_papers_update on exam_papers for update to authenticated
  using (
    school_id = (select auth_school_id())
    and (auth_has_permission('exams.write') or (auth_has_permission('exams.generate_paper_ai') and created_by = (select auth_school_user_id())))
  )
  with check (
    school_id = (select auth_school_id())
    and (auth_has_permission('exams.write') or (auth_has_permission('exams.generate_paper_ai') and created_by = (select auth_school_user_id())))
  );
create policy exam_papers_delete on exam_papers for delete to authenticated
  using (
    school_id = (select auth_school_id())
    and (auth_has_permission('exams.write') or (auth_has_permission('exams.generate_paper_ai') and created_by = (select auth_school_user_id())))
  );

create policy exam_paper_questions_select on exam_paper_questions for select to authenticated
  using (exists (
    select 1 from exam_papers p
    where p.id = exam_paper_questions.paper_id
      and (auth_is_super_admin()
        or (p.school_id = (select auth_school_id()) and (auth_has_permission('exams.read') or p.created_by = (select auth_school_user_id()))))
  ));
create policy exam_paper_questions_write on exam_paper_questions for all to authenticated
  using (exists (
    select 1 from exam_papers p
    where p.id = exam_paper_questions.paper_id
      and p.school_id = (select auth_school_id())
      and (auth_has_permission('exams.write') or (auth_has_permission('exams.generate_paper_ai') and p.created_by = (select auth_school_user_id())))
  ))
  with check (exists (
    select 1 from exam_papers p
    where p.id = exam_paper_questions.paper_id
      and p.school_id = (select auth_school_id())
      and (auth_has_permission('exams.write') or (auth_has_permission('exams.generate_paper_ai') and p.created_by = (select auth_school_user_id())))
  ));

-- AI request log: a user sees/writes only their own, inside their school.
create policy exam_paper_ai_requests_select on exam_paper_ai_requests for select to authenticated
  using (auth_is_super_admin() or (school_id = (select auth_school_id()) and requested_by = (select auth_school_user_id())));
create policy exam_paper_ai_requests_insert on exam_paper_ai_requests for insert to authenticated
  with check (school_id = (select auth_school_id()) and requested_by = (select auth_school_user_id()) and auth_has_permission('exams.generate_paper_ai'));
create policy exam_paper_ai_requests_update on exam_paper_ai_requests for update to authenticated
  using (school_id = (select auth_school_id()) and requested_by = (select auth_school_user_id()))
  with check (school_id = (select auth_school_id()) and requested_by = (select auth_school_user_id()));
