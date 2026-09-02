-- Evidence/Portfolio module (CBC/CBE investigation, Phase 2).
--
-- Gap identified in the CBC/CBE investigation report: no table linked an
-- uploaded file (photo of a project, recording, work sample) to a specific
-- sub-strand competency rating. Everything else about CBC assessment
-- already exists (curriculum_strands/curriculum_sub_strands/competency_marks,
-- 20260806060917) -- this is purely additive on top of that, same convention
-- as every other document bucket in this codebase (staff-documents,
-- assignment-attachments, admission-form-templates): a school-scoped private
-- bucket + a table row per file, RLS on both.
--
-- competency_evidence.competency_mark_id is required (not nullable) --
-- evidence is proof attached to an already-recorded rating, not a free-
-- floating upload. One rating can have many pieces of evidence (one-to-many).
-- Evidence is retained even if the rating is later corrected -- edit_reason
-- on competency_marks already explains why a rating changed; evidence is a
-- separate, additive record and is never silently deleted by a rating edit.

create table competency_evidence (
  id uuid primary key default gen_random_uuid(),
  school_id uuid not null references schools(id),
  competency_mark_id uuid not null references competency_marks(id) on delete cascade,
  storage_path text not null unique,
  file_name text not null,
  uploaded_by uuid references school_users(id),
  created_at timestamptz not null default now()
);
comment on table competency_evidence is 'Files (photos, recordings, work samples) attached as proof of a specific sub-strand competency rating (competency_marks). One-to-many per rating. Additive only -- never rewritten by a later mark correction.';

create index idx_competency_evidence_mark on competency_evidence(competency_mark_id);
create index idx_competency_evidence_school on competency_evidence(school_id);

alter table competency_evidence enable row level security;

-- Select: same visibility as the underlying competency_marks row --
-- school staff with exams.read, or the student's own guardian/self once a
-- report card for that exam has actually been released to them. Mirrors
-- competency_marks_select in 20260806060917 exactly, re-derived via the
-- competency_mark_id FK instead of duplicating exam_id/student_id columns.
create policy competency_evidence_select on competency_evidence
  for select to authenticated
  using (
    (school_id = auth_school_id() and auth_has_permission('exams.read'))
    or exists (
      select 1 from competency_marks cm
      where cm.id = competency_evidence.competency_mark_id
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

-- Write: exactly the same authority that could write the underlying rating
-- in the first place -- marks.write_any for any row in-school, or
-- marks.write scoped to a teacher who actually teaches that subject/stream.
-- No separate "evidence.write" permission introduced -- reuses the existing
-- marks authority boundary rather than inventing a parallel one.
create policy competency_evidence_write_any on competency_evidence
  for all to authenticated
  using (school_id = auth_school_id() and auth_has_permission('marks.write_any'))
  with check (school_id = auth_school_id() and auth_has_permission('marks.write_any'));

create policy competency_evidence_write_own on competency_evidence
  for all to authenticated
  using (
    school_id = auth_school_id() and auth_has_permission('marks.write')
    and exists (
      select 1 from competency_marks cm
      join students st on st.id = cm.student_id
      join curriculum_sub_strands css on css.id = cm.sub_strand_id
      join curriculum_strands cst on cst.id = css.strand_id
      where cm.id = competency_evidence.competency_mark_id
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
      where cm.id = competency_evidence.competency_mark_id
        and auth_user_teaches_subject_in_stream(st.current_class_id, cst.subject_id)
    )
  );

-- ----------------------------------------------------------------------------
-- Storage bucket. Path convention: {school_id}/{competency_mark_id}/{filename}
-- -- lets storage RLS re-derive the same authorization from the folder
-- segments without needing extra columns duplicated onto the object path.
-- 20MB limit, image/pdf/audio/video mime allowlist to cover "photo of a
-- project, recording, work sample" from the investigation report -- same
-- shape as assignment-attachments (20260902100208).
-- ----------------------------------------------------------------------------

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'competency-evidence', 'competency-evidence', false, 20971520,
  array[
    'image/jpeg',
    'image/png',
    'image/webp',
    'application/pdf',
    'audio/mpeg',
    'audio/mp4',
    'video/mp4'
  ]
)
on conflict (id) do nothing;

create policy competency_evidence_storage_select on storage.objects
  for select using (
    bucket_id = 'competency-evidence'
    and exists (
      select 1 from competency_marks cm
      where cm.id::text = (storage.foldername(name))[2]
        and (
          (cm.school_id = auth_school_id() and auth_has_permission('exams.read'))
          or (auth_user_id_is_guardian_of(cm.student_id) and exists (
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

create policy competency_evidence_storage_write on storage.objects
  for insert with check (
    bucket_id = 'competency-evidence'
    and exists (
      select 1 from competency_marks cm
      where cm.id::text = (storage.foldername(name))[2]
        and (
          (cm.school_id = auth_school_id() and auth_has_permission('marks.write_any'))
          or (
            cm.school_id = auth_school_id() and auth_has_permission('marks.write')
            and exists (
              select 1 from students st
              join curriculum_sub_strands css on css.id = cm.sub_strand_id
              join curriculum_strands cst on cst.id = css.strand_id
              where st.id = cm.student_id
                and auth_user_teaches_subject_in_stream(st.current_class_id, cst.subject_id)
            )
          )
        )
    )
  );

create policy competency_evidence_storage_delete on storage.objects
  for delete using (
    bucket_id = 'competency-evidence'
    and exists (
      select 1 from competency_marks cm
      where cm.id::text = (storage.foldername(name))[2]
        and (
          (cm.school_id = auth_school_id() and auth_has_permission('marks.write_any'))
          or (
            cm.school_id = auth_school_id() and auth_has_permission('marks.write')
            and exists (
              select 1 from students st
              join curriculum_sub_strands css on css.id = cm.sub_strand_id
              join curriculum_strands cst on cst.id = css.strand_id
              where st.id = cm.student_id
                and auth_user_teaches_subject_in_stream(st.current_class_id, cst.subject_id)
            )
          )
        )
    )
  );
