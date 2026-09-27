-- Curriculum PDF grounding, Phase 2A (KICD/CBC investigation, roadmap Item 1
-- follow-up). Lets a school ground AI Scheme of Work generation in their
-- OWN curriculum document instead of hand-typing strand-by-strand into the
-- Exams -> Marks CBC form (which is where curriculum_strands/
-- curriculum_sub_strands, 20260806060917, are populated today, for an
-- unrelated purpose -- competency marking). A teacher/HOD uploads a PDF for
-- a subject; an AI extraction pass proposes structured strand/sub-strand
-- content and writes it as new curriculum_strands/curriculum_sub_strands
-- rows with content_source = 'draft' (20260903115646's existing gate --
-- already excluded from AI-generation grounding by buildCurriculumContext,
-- reused here rather than inventing a second flag); a human then reviews
-- each row against the source PDF and either edits/promotes it to
-- 'school_authored' (via the existing updateCurriculumSubStrandContent
-- action, unchanged) or discards it. This migration adds ONLY the storage
-- and audit trail for that pipeline -- it does not write any curriculum
-- content itself, and nothing here can ever set content_source to
-- 'kicd_licensed' (see actions.ts: the extraction/promotion code path only
-- ever writes 'draft' or 'school_authored' -- KICD's own licensing question
-- is still unresolved, per 20260903115646's comment, and stays out of scope).

-- ---------------------------------------------------------------------------
-- New permission: academics.curriculum_upload.
--
-- curriculum_strands/curriculum_sub_strands writes are gated behind
-- academics.write today, held only by school_owner/principal/deputy_principal
-- -- not the plain teacher/class_teacher roles who actually own a subject's
-- Scheme of Work day to day. Rather than widen academics.write itself (which
-- would also hand teachers the ability to rename/delete any strand, edit
-- rubric_text, and directly promote content to school_authored/kicd_licensed),
-- this is a narrow, additive permission: it only ever lets its holder INSERT
-- new rows that are (a) tied to an extraction batch and (b) content_source =
-- 'draft' -- see the INSERT-only policies below. Reviewing/editing/promoting/
-- deleting a row, and creating a strand/sub-strand by hand outside this
-- pipeline, still requires academics.write, unchanged. An academics.write
-- holder can already do everything this permission allows (the RLS policies
-- below OR the two together), so it is not additionally granted to
-- school_owner/principal/deputy_principal -- only to the roles that actually
-- lacked any curriculum-write path before this migration.
insert into role_permissions (role_id, permission_key, allowed)
select id, 'academics.curriculum_upload', true from roles where name in ('teacher', 'class_teacher');

-- ---------------------------------------------------------------------------
-- curriculum_extraction_batches: one row per uploaded PDF/extraction attempt.
-- Mirrors scheme_of_work_ai_requests' shape/purpose (20260924140000) --
-- audit trail + idempotent status tracking for an AI call -- rather than
-- inventing a new pattern. "Reviewed" is intentionally NOT a stored status
-- here: it's computed live as "no curriculum_sub_strands row with this
-- extraction_batch_id still has content_source = 'draft'", so there is no
-- second place that can drift out of sync with the actual row states.
-- ---------------------------------------------------------------------------
create table curriculum_extraction_batches (
  id uuid primary key default gen_random_uuid(),
  school_id uuid not null references schools(id),
  subject_id uuid not null references subjects(id),
  storage_path text not null unique,
  file_name text not null,
  uploaded_by uuid references school_users(id),
  status text not null default 'processing' check (status in ('processing', 'extracted', 'failed')),
  failure_category text,
  prompt_version text,
  strands_extracted smallint,
  sub_strands_extracted smallint,
  created_at timestamptz not null default now(),
  completed_at timestamptz
);
comment on table curriculum_extraction_batches is 'One row per uploaded curriculum PDF + AI extraction attempt for a subject. The extracted strands/sub-strands themselves land in curriculum_strands/curriculum_sub_strands (content_source=draft, extraction_batch_id set here) -- this table is the audit trail and upload/status record, not a duplicate copy of the content.';

create index idx_curriculum_extraction_batches_subject on curriculum_extraction_batches(subject_id);
create index idx_curriculum_extraction_batches_school on curriculum_extraction_batches(school_id);

alter table curriculum_extraction_batches enable row level security;

-- Select: academics.read (same authority that can see curriculum_strands
-- content at all), OR the uploader checking their own upload's status --
-- deliberately allowed even without academics.read, since a teacher who can
-- upload (academics.curriculum_upload) but not otherwise read curriculum
-- content still needs to see whether their own upload succeeded or failed.
create policy curriculum_extraction_batches_select on curriculum_extraction_batches
  for select to authenticated
  using (
    auth_is_super_admin()
    or (school_id = auth_school_id() and auth_has_permission('academics.read'))
    or (uploaded_by = auth_school_user_id())
  );

-- Insert: academics.write OR academics.curriculum_upload -- the upload step
-- itself (as opposed to reviewing/promoting its results) is exactly what
-- the narrower permission is for.
create policy curriculum_extraction_batches_insert on curriculum_extraction_batches
  for insert to authenticated
  with check (
    school_id = auth_school_id()
    and (auth_has_permission('academics.write') or auth_has_permission('academics.curriculum_upload'))
  );

-- Update (status transitions written by the server action as the AI call
-- progresses/completes/fails) -- same authority as insert, scoped to the
-- uploader's own batch for a curriculum_upload-only holder so they can't
-- reach into another teacher's in-flight upload.
create policy curriculum_extraction_batches_update on curriculum_extraction_batches
  for update to authenticated
  using (
    school_id = auth_school_id()
    and (auth_has_permission('academics.write') or (auth_has_permission('academics.curriculum_upload') and uploaded_by = auth_school_user_id()))
  )
  with check (
    school_id = auth_school_id()
    and (auth_has_permission('academics.write') or (auth_has_permission('academics.curriculum_upload') and uploaded_by = auth_school_user_id()))
  );

-- ---------------------------------------------------------------------------
-- Trace extracted rows back to the batch/PDF that produced them. Nullable
-- and additive: every existing hand-created strand/sub-strand row (via
-- createCurriculumStrand/createCurriculumSubStrand or
-- updateCurriculumSubStrandContent, all unchanged) stays null here, exactly
-- as before this migration.
-- ---------------------------------------------------------------------------
alter table curriculum_strands
  add column extraction_batch_id uuid references curriculum_extraction_batches(id);
alter table curriculum_sub_strands
  add column extraction_batch_id uuid references curriculum_extraction_batches(id);

comment on column curriculum_strands.extraction_batch_id is 'Set when this strand was created by the curriculum-PDF extraction pipeline (curriculum_extraction_batches); null for hand-created strands. Lets the review screen group/filter by source document.';
comment on column curriculum_sub_strands.extraction_batch_id is 'Same as curriculum_strands.extraction_batch_id. Combined with content_source=draft, this is how the review screen finds "still-pending-review" rows for a given upload.';

-- ---------------------------------------------------------------------------
-- New, narrowly-scoped INSERT policies for academics.curriculum_upload
-- holders -- additive alongside the existing curriculum_strands_write /
-- curriculum_sub_strands_write "for all" policies (20260806060917 and its
-- perf-consolidation follow-ups), which are untouched and still govern
-- update/delete/insert for academics.write holders exactly as before.
-- Postgres RLS policies are OR'd per operation, so an academics.write holder
-- is unaffected by these new policies existing at all.
--
-- A curriculum_upload-only holder can insert a curriculum_strands row
-- (school-scoped) at any time -- a bare strand name carries no untrusted
-- "content" by itself, unlike a sub-strand's free-text fields -- but a
-- curriculum_sub_strands row only ever insertable through this permission
-- when it is (a) tied to an extraction_batch_id and (b) content_source =
-- 'draft': this is what makes it structurally impossible for this narrower
-- permission to ever write school_authored/kicd_licensed content, or to
-- insert a sub-strand outside the reviewed-extraction pipeline.
-- ---------------------------------------------------------------------------
create policy curriculum_strands_insert_extraction on curriculum_strands
  for insert to authenticated
  with check (school_id = auth_school_id() and auth_has_permission('academics.curriculum_upload'));

create policy curriculum_sub_strands_insert_extraction on curriculum_sub_strands
  for insert to authenticated
  with check (
    extraction_batch_id is not null
    and content_source = 'draft'
    and exists (
      select 1 from curriculum_strands cs
      where cs.id = curriculum_sub_strands.strand_id
        and cs.school_id = auth_school_id()
        and auth_has_permission('academics.curriculum_upload')
    )
  );

-- ---------------------------------------------------------------------------
-- Storage bucket for the uploaded PDFs. Path convention:
-- {school_id}/{subject_id}/{batch_id}-{filename} -- same shape as
-- competency-evidence (20260902203459), letting storage RLS re-derive
-- authorization from the folder segments. 20MB limit, PDF only.
-- ---------------------------------------------------------------------------
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('curriculum-documents', 'curriculum-documents', false, 20971520, array['application/pdf'])
on conflict (id) do nothing;

create policy curriculum_documents_storage_select on storage.objects
  for select using (
    bucket_id = 'curriculum-documents'
    and (
      (storage.foldername(name))[1]::uuid = auth_school_id()
      and (auth_has_permission('academics.read') or auth_has_permission('academics.curriculum_upload') or auth_has_permission('academics.write'))
    )
  );

create policy curriculum_documents_storage_insert on storage.objects
  for insert with check (
    bucket_id = 'curriculum-documents'
    and (storage.foldername(name))[1]::uuid = auth_school_id()
    and (auth_has_permission('academics.write') or auth_has_permission('academics.curriculum_upload'))
  );

create policy curriculum_documents_storage_delete on storage.objects
  for delete using (
    bucket_id = 'curriculum-documents'
    and (storage.foldername(name))[1]::uuid = auth_school_id()
    and auth_has_permission('academics.write')
  );
