-- ============================================================================
-- Homework: assignment task attachments + submission attachments
--
-- Two new tables, mirroring the announcement_attachments pattern (PA-08):
--   - assignment_attachments: files the teacher uploads with the assignment
--     (the task/worksheet itself). RLS piggybacks on the same three
--     conditions as assignments' own select policies (staff/guardian/self).
--   - assignment_submission_attachments: files a student/guardian uploads as
--     their completed work. RLS piggybacks on assignment_submissions' own
--     select/insert conditions, and (like the existing
--     assignment_submissions_update_own resubmission policy) only allows
--     write/delete while status = 'submitted' -- locked once graded.
--
-- Unlike announcements, this module already does direct client
-- insert/upsert against RLS-protected tables (see submitHomeworkAction) --
-- no security-definer RPC layer exists here, so these new tables follow the
-- same lighter-weight direct-RLS convention rather than introducing one.
--
-- Storage: one shared private bucket, 'assignment-attachments', split by
-- folder position so a single set of storage RLS policies can't be confused
-- between the two flows:
--   task file:       {school_id}/{assignment_id}/task/{ts}-{filename}
--   submission file: {school_id}/{assignment_id}/submission/{submission_id}/{ts}-{filename}
-- ============================================================================

create table assignment_attachments (
  id uuid primary key default gen_random_uuid(),
  assignment_id uuid not null references assignments(id) on delete cascade,
  storage_path text not null,
  file_name text not null,
  file_size bigint,
  content_type text,
  uploaded_by uuid not null references school_users(id),
  created_at timestamptz not null default now()
);

create index idx_assignment_attachments_assignment_id on assignment_attachments(assignment_id);

alter table assignment_attachments enable row level security;

-- Anyone who can see the assignment itself can see its task attachments --
-- same three conditions as assignments_select_staff/_guardian/_self.
create policy assignment_attachments_select on assignment_attachments for select
using (
  exists (
    select 1 from assignments a
    where a.id = assignment_attachments.assignment_id
      and (
        (a.school_id = auth_school_id() and auth_has_permission('academics.read'))
        or exists (select 1 from students st join student_guardians sg on sg.student_id = st.id join school_users su on su.id = sg.guardian_user_id where st.current_class_id = a.stream_id and su.auth_user_id = (select auth.uid()))
        or exists (select 1 from students st join school_users su on su.id = st.school_user_id where st.current_class_id = a.stream_id and su.auth_user_id = (select auth.uid()))
      )
  )
);

create policy assignment_attachments_insert on assignment_attachments for insert
with check (
  exists (
    select 1 from assignments a
    where a.id = assignment_attachments.assignment_id
      and a.school_id = auth_school_id()
      and (auth_has_permission('academics.write') or a.teacher_id = auth_school_user_id())
  )
);

create policy assignment_attachments_delete on assignment_attachments for delete
using (
  exists (
    select 1 from assignments a
    where a.id = assignment_attachments.assignment_id
      and a.school_id = auth_school_id()
      and (auth_has_permission('academics.write') or a.teacher_id = auth_school_user_id())
  )
);

create table assignment_submission_attachments (
  id uuid primary key default gen_random_uuid(),
  submission_id uuid not null references assignment_submissions(id) on delete cascade,
  storage_path text not null,
  file_name text not null,
  file_size bigint,
  content_type text,
  uploaded_by uuid not null references school_users(id),
  created_at timestamptz not null default now()
);

create index idx_assignment_submission_attachments_submission_id on assignment_submission_attachments(submission_id);

alter table assignment_submission_attachments enable row level security;

-- Same visibility as assignment_submissions itself: the assignment's
-- teacher/academics.write staff, the student's guardian, or the student.
create policy assignment_submission_attachments_select on assignment_submission_attachments for select
using (
  exists (
    select 1 from assignment_submissions s
    join assignments a on a.id = s.assignment_id
    where s.id = assignment_submission_attachments.submission_id
      and (
        (a.school_id = auth_school_id() and (auth_has_permission('academics.read') or a.teacher_id = auth_school_user_id()))
        or auth_user_id_is_guardian_of(s.student_id)
        or exists (select 1 from students st join school_users su on su.id = st.school_user_id where st.id = s.student_id and su.auth_user_id = (select auth.uid()))
      )
  )
);

-- Write/delete only while the submission is still 'submitted' (not graded
-- yet) -- same resubmission window as assignment_submissions_update_own.
create policy assignment_submission_attachments_insert on assignment_submission_attachments for insert
with check (
  exists (
    select 1 from assignment_submissions s
    where s.id = assignment_submission_attachments.submission_id
      and s.status = 'submitted'
      and (
        auth_user_id_is_guardian_of(s.student_id)
        or exists (select 1 from students st join school_users su on su.id = st.school_user_id where st.id = s.student_id and su.auth_user_id = (select auth.uid()))
      )
  )
);

create policy assignment_submission_attachments_delete on assignment_submission_attachments for delete
using (
  exists (
    select 1 from assignment_submissions s
    where s.id = assignment_submission_attachments.submission_id
      and s.status = 'submitted'
      and (
        auth_user_id_is_guardian_of(s.student_id)
        or exists (select 1 from students st join school_users su on su.id = st.school_user_id where st.id = s.student_id and su.auth_user_id = (select auth.uid()))
      )
  )
);

-- ----------------------------------------------------------------------------
-- Storage bucket
-- ----------------------------------------------------------------------------

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'assignment-attachments', 'assignment-attachments', false, 20971520,
  array[
    'application/pdf',
    'application/msword',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'application/vnd.ms-powerpoint',
    'application/vnd.openxmlformats-officedocument.presentationml.presentation',
    'application/vnd.ms-excel',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    'image/jpeg',
    'image/png',
    'image/webp',
    'text/plain'
  ]
)
on conflict (id) do nothing;

create policy assignment_attachments_storage_task_write on storage.objects
for insert with check (
  bucket_id = 'assignment-attachments'
  and (storage.foldername(name))[3] = 'task'
  and (storage.foldername(name))[1]::uuid = auth_school_id()
  and exists (
    select 1 from assignments a
    where a.id = ((storage.foldername(name))[2])::uuid
      and a.school_id = auth_school_id()
      and (auth_has_permission('academics.write') or a.teacher_id = auth_school_user_id())
  )
);

create policy assignment_attachments_storage_task_select on storage.objects
for select using (
  bucket_id = 'assignment-attachments'
  and (storage.foldername(name))[3] = 'task'
  and exists (
    select 1 from assignments a
    where a.id = ((storage.foldername(name))[2])::uuid
      and (
        (a.school_id = auth_school_id() and auth_has_permission('academics.read'))
        or a.teacher_id = auth_school_user_id()
        or exists (select 1 from students st join student_guardians sg on sg.student_id = st.id join school_users su on su.id = sg.guardian_user_id where st.current_class_id = a.stream_id and su.auth_user_id = (select auth.uid()))
        or exists (select 1 from students st join school_users su on su.id = st.school_user_id where st.current_class_id = a.stream_id and su.auth_user_id = (select auth.uid()))
      )
  )
);

create policy assignment_attachments_storage_task_delete on storage.objects
for delete using (
  bucket_id = 'assignment-attachments'
  and (storage.foldername(name))[3] = 'task'
  and exists (
    select 1 from assignments a
    where a.id = ((storage.foldername(name))[2])::uuid
      and a.school_id = auth_school_id()
      and (auth_has_permission('academics.write') or a.teacher_id = auth_school_user_id())
  )
);

create policy assignment_attachments_storage_submission_write on storage.objects
for insert with check (
  bucket_id = 'assignment-attachments'
  and (storage.foldername(name))[3] = 'submission'
  and (storage.foldername(name))[1]::uuid = auth_school_id()
  and exists (
    select 1 from assignment_submissions s
    join assignments a on a.id = s.assignment_id
    where s.id = ((storage.foldername(name))[4])::uuid
      and a.id = ((storage.foldername(name))[2])::uuid
      and s.status = 'submitted'
      and (
        auth_user_id_is_guardian_of(s.student_id)
        or exists (select 1 from students st join school_users su on su.id = st.school_user_id where st.id = s.student_id and su.auth_user_id = (select auth.uid()))
      )
  )
);

create policy assignment_attachments_storage_submission_select on storage.objects
for select using (
  bucket_id = 'assignment-attachments'
  and (storage.foldername(name))[3] = 'submission'
  and exists (
    select 1 from assignment_submissions s
    join assignments a on a.id = s.assignment_id
    where s.id = ((storage.foldername(name))[4])::uuid
      and (
        (a.school_id = auth_school_id() and (auth_has_permission('academics.read') or a.teacher_id = auth_school_user_id()))
        or auth_user_id_is_guardian_of(s.student_id)
        or exists (select 1 from students st join school_users su on su.id = st.school_user_id where st.id = s.student_id and su.auth_user_id = (select auth.uid()))
      )
  )
);

create policy assignment_attachments_storage_submission_delete on storage.objects
for delete using (
  bucket_id = 'assignment-attachments'
  and (storage.foldername(name))[3] = 'submission'
  and exists (
    select 1 from assignment_submissions s
    where s.id = ((storage.foldername(name))[4])::uuid
      and s.status = 'submitted'
      and (
        auth_user_id_is_guardian_of(s.student_id)
        or exists (select 1 from students st join school_users su on su.id = st.school_user_id where st.id = s.student_id and su.auth_user_id = (select auth.uid()))
      )
  )
);
