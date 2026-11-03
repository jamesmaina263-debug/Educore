-- Phase 8.1 (1/3): learning portal lite, database core. Additive only; ships dark.
--
-- * New flag feature.learning.portal (catalog entry, enabled for nobody).
-- * learning_resources: notes (text), video links, past-paper links, live-lesson meeting links and other
--   links, per stream and subject. Links only: no file uploads and no new storage bucket in this package.
-- * learning_quizzes + learning_quiz_questions + learning_quiz_keys + learning_quiz_attempts: multiple-choice
--   quizzes that are marked on the server. The answer key lives in its own staff-only table so a learner can
--   never read it, whatever columns the client asks for.
-- * Who sees what (same model as Homework): staff with academics.read see everything in their school;
--   a guardian sees content for the stream their child is currently in; a student sees content for their own
--   stream. Learners and guardians see published content only.
-- * Who writes: any staff member with academics.read (teachers included) can create content and change their
--   own; academics.write (owner, principal, deputy) can change anyone's. There are NO direct write policies:
--   everything goes through the SECURITY DEFINER functions below, which re-check the flag every time.
-- * Quiz attempts are only created by submit_learning_quiz(), by the student's own login or a guardian of that
--   student, only for a published quiz of the student's own stream, up to the quiz's attempt limit.
-- * Sends nothing (no SMS, email, WhatsApp or push), takes no payment, touches no existing table.
-- Rollback: switch the flag off (reads return nothing, functions refuse). Nothing existing depends on these objects.

-- 1. Flag catalog entry.
insert into public.platform_feature_flags (key, label, description)
select 'feature.learning.portal',
       'Learning portal lite',
       'Notes, video links, past papers, live-lesson links and auto-marked quizzes per class and subject. Links only; sends nothing. Off by default.'
where not exists (
  select 1 from public.platform_feature_flags where lower(key) = 'feature.learning.portal'
);

-- 2. Visibility helpers used by the policies and the functions.
create or replace function public.learning_is_staff()
returns boolean
language sql
stable
security definer
set search_path to 'public'
as $$
  select auth_has_permission('academics.read');
$$;

create or replace function public.learning_can_see_stream(p_school uuid, p_stream uuid)
returns boolean
language sql
stable
security definer
set search_path to 'public'
as $$
  select p_school = auth_school_id()
    and public.my_school_has_feature_flag('feature.learning.portal')
    and (
      auth_has_permission('academics.read')
      or exists (
        select 1 from students st
          join student_guardians sg on sg.student_id = st.id
          join school_users su on su.id = sg.guardian_user_id
        where st.current_class_id = p_stream and su.auth_user_id = auth.uid() and su.status = 'active'
      )
      or exists (
        select 1 from students st
          join school_users su on su.id = st.school_user_id
        where st.current_class_id = p_stream and su.auth_user_id = auth.uid() and su.status = 'active'
      )
    );
$$;

revoke all on function public.learning_is_staff() from public, anon;
revoke all on function public.learning_can_see_stream(uuid, uuid) from public, anon;
grant execute on function public.learning_is_staff() to authenticated;
grant execute on function public.learning_can_see_stream(uuid, uuid) to authenticated;

-- 3. Resources.
create table if not exists public.learning_resources (
  id uuid primary key default gen_random_uuid(),
  school_id uuid not null references public.schools(id) on delete cascade,
  stream_id uuid not null references public.streams(id) on delete cascade,
  subject_id uuid not null references public.subjects(id) on delete cascade,
  kind text not null check (kind in ('note', 'video', 'past_paper', 'live_lesson', 'link')),
  title text not null check (char_length(btrim(title)) between 1 and 150),
  body text check (body is null or char_length(body) <= 8000),
  url text check (url is null or (char_length(url) <= 500 and url ~* '^https://[^[:space:]]+$')),
  starts_at timestamptz,
  paper_year integer check (paper_year is null or paper_year between 1990 and 2100),
  published boolean not null default false,
  created_by uuid references public.school_users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint learning_resources_shape check (
    (kind = 'note' and body is not null and url is null and starts_at is null and paper_year is null)
    or (kind = 'video' and url is not null and starts_at is null and paper_year is null)
    or (kind = 'link' and url is not null and starts_at is null and paper_year is null)
    or (kind = 'past_paper' and url is not null and starts_at is null)
    or (kind = 'live_lesson' and url is not null and starts_at is not null and paper_year is null)
  )
);
comment on table public.learning_resources is
  'Learning material per stream and subject. Links only (https). Written only by save_learning_resource() / delete_learning_resource().';
create index if not exists learning_resources_stream on public.learning_resources (school_id, stream_id, subject_id);
alter table public.learning_resources enable row level security;
drop policy if exists learning_resources_select on public.learning_resources;
create policy learning_resources_select on public.learning_resources for select
  using (
    public.learning_can_see_stream(school_id, stream_id)
    and (published or public.learning_is_staff())
  );

-- 4. Quizzes.
create table if not exists public.learning_quizzes (
  id uuid primary key default gen_random_uuid(),
  school_id uuid not null references public.schools(id) on delete cascade,
  stream_id uuid not null references public.streams(id) on delete cascade,
  subject_id uuid not null references public.subjects(id) on delete cascade,
  title text not null check (char_length(btrim(title)) between 1 and 150),
  description text check (description is null or char_length(description) <= 2000),
  max_attempts integer not null default 1 check (max_attempts between 1 and 10),
  show_answers boolean not null default false,
  status text not null default 'draft' check (status in ('draft', 'published', 'closed')),
  created_by uuid references public.school_users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
comment on table public.learning_quizzes is
  'A multiple-choice quiz. Written only by save_learning_quiz(). A quiz with attempts is closed, never deleted.';
create index if not exists learning_quizzes_stream on public.learning_quizzes (school_id, stream_id, subject_id);
alter table public.learning_quizzes enable row level security;
drop policy if exists learning_quizzes_select on public.learning_quizzes;
create policy learning_quizzes_select on public.learning_quizzes for select
  using (
    public.learning_can_see_stream(school_id, stream_id)
    and (status in ('published', 'closed') or public.learning_is_staff())
  );

drop trigger if exists trg_audit_learning_quizzes on public.learning_quizzes;
create trigger trg_audit_learning_quizzes
  after insert or update or delete on public.learning_quizzes
  for each row execute function public.audit_row_change();

create table if not exists public.learning_quiz_questions (
  id uuid primary key default gen_random_uuid(),
  school_id uuid not null references public.schools(id) on delete cascade,
  quiz_id uuid not null references public.learning_quizzes(id) on delete cascade,
  position integer not null check (position between 1 and 50),
  prompt text not null check (char_length(btrim(prompt)) between 1 and 1000),
  options jsonb not null check (jsonb_typeof(options) = 'array' and jsonb_array_length(options) between 2 and 6),
  marks integer not null default 1 check (marks between 1 and 10),
  unique (quiz_id, position)
);
comment on table public.learning_quiz_questions is 'Questions and options only. The answer key is in learning_quiz_keys (staff-only).';
alter table public.learning_quiz_questions enable row level security;
drop policy if exists learning_quiz_questions_select on public.learning_quiz_questions;
create policy learning_quiz_questions_select on public.learning_quiz_questions for select
  using (exists (select 1 from public.learning_quizzes q where q.id = learning_quiz_questions.quiz_id));

create table if not exists public.learning_quiz_keys (
  question_id uuid primary key references public.learning_quiz_questions(id) on delete cascade,
  school_id uuid not null references public.schools(id) on delete cascade,
  correct_index integer not null check (correct_index between 0 and 5)
);
comment on table public.learning_quiz_keys is 'Answer key. Staff-only: a learner or guardian can never read it.';
alter table public.learning_quiz_keys enable row level security;
drop policy if exists learning_quiz_keys_select on public.learning_quiz_keys;
create policy learning_quiz_keys_select on public.learning_quiz_keys for select
  using (
    school_id = auth_school_id()
    and public.learning_is_staff()
    and public.my_school_has_feature_flag('feature.learning.portal')
  );

create table if not exists public.learning_quiz_attempts (
  id uuid primary key default gen_random_uuid(),
  school_id uuid not null references public.schools(id) on delete cascade,
  quiz_id uuid not null references public.learning_quizzes(id) on delete cascade,
  student_id uuid not null references public.students(id) on delete cascade,
  attempt_no integer not null check (attempt_no between 1 and 10),
  answers jsonb not null,
  score integer not null check (score >= 0),
  total integer not null check (total >= 1),
  submitted_by uuid references public.school_users(id) on delete set null,
  created_at timestamptz not null default now(),
  unique (quiz_id, student_id, attempt_no)
);
comment on table public.learning_quiz_attempts is 'One row per marked attempt. Written only by submit_learning_quiz(); never edited or deleted.';
create index if not exists learning_quiz_attempts_student on public.learning_quiz_attempts (student_id, quiz_id);
alter table public.learning_quiz_attempts enable row level security;
drop policy if exists learning_quiz_attempts_select on public.learning_quiz_attempts;
create policy learning_quiz_attempts_select on public.learning_quiz_attempts for select
  using (
    school_id = auth_school_id()
    and public.my_school_has_feature_flag('feature.learning.portal')
    and (
      public.learning_is_staff()
      or auth_user_id_is_guardian_of(student_id)
      or exists (
        select 1 from public.students st join public.school_users su on su.id = st.school_user_id
        where st.id = learning_quiz_attempts.student_id and su.auth_user_id = auth.uid()
      )
    )
  );

-- 5. Shared guard: staff (academics.read) in their own school, flag on. Returns the school id.
create or replace function public.learning_guard()
returns uuid
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_school uuid := auth_school_id();
begin
  if v_school is null or not auth_has_permission('academics.read') then
    raise exception 'Not authorized to manage learning content.' using errcode = '42501';
  end if;
  if not public.school_has_feature_flag(v_school, 'feature.learning.portal') then
    raise exception 'The learning portal is not enabled for this school.' using errcode = '55000';
  end if;
  return v_school;
end;
$$;
revoke all on function public.learning_guard() from public, anon, authenticated;

-- 6. Save a resource (create when p_id is null).
create or replace function public.save_learning_resource(
  p_id uuid,
  p_stream_id uuid,
  p_subject_id uuid,
  p_kind text,
  p_title text,
  p_body text,
  p_url text,
  p_starts_at timestamptz,
  p_paper_year integer,
  p_published boolean
) returns uuid
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_school uuid := public.learning_guard();
  v_actor uuid;
  v_owner uuid;
  v_id uuid;
begin
  if p_kind is null or p_kind not in ('note', 'video', 'past_paper', 'live_lesson', 'link')
     or p_title is null or char_length(btrim(p_title)) not between 1 and 150
     or (p_body is not null and char_length(p_body) > 8000)
     or (p_url is not null and (char_length(p_url) > 500 or p_url !~* '^https://[^[:space:]]+$'))
     or p_published is null then
    raise exception 'Invalid learning resource.' using errcode = '22023';
  end if;
  if p_kind = 'note' and (nullif(btrim(p_body), '') is null or p_url is not null or p_starts_at is not null or p_paper_year is not null) then
    raise exception 'A note needs text and nothing else.' using errcode = '22023';
  end if;
  if p_kind in ('video', 'link') and (p_url is null or p_starts_at is not null or p_paper_year is not null) then
    raise exception 'A video or link needs an https link only.' using errcode = '22023';
  end if;
  if p_kind = 'past_paper' and (p_url is null or p_starts_at is not null or (p_paper_year is not null and p_paper_year not between 1990 and 2100)) then
    raise exception 'A past paper needs an https link and, optionally, a year.' using errcode = '22023';
  end if;
  if p_kind = 'live_lesson' and (p_url is null or p_starts_at is null or p_paper_year is not null) then
    raise exception 'A live lesson needs a meeting link and a start time.' using errcode = '22023';
  end if;
  if not exists (select 1 from public.streams where id = p_stream_id and school_id = v_school)
     or not exists (select 1 from public.subjects where id = p_subject_id and school_id = v_school) then
    raise exception 'Class or subject not found.' using errcode = 'P0002';
  end if;

  select id into v_actor from public.school_users
   where auth_user_id = auth.uid() and school_id = v_school and status = 'active' limit 1;

  if p_id is null then
    insert into public.learning_resources
      (school_id, stream_id, subject_id, kind, title, body, url, starts_at, paper_year, published, created_by)
    values (v_school, p_stream_id, p_subject_id, p_kind, btrim(p_title),
            case when p_kind = 'note' then btrim(p_body) end, case when p_kind <> 'note' then btrim(p_url) end,
            p_starts_at, p_paper_year, p_published, v_actor)
    returning id into v_id;
  else
    select created_by into v_owner from public.learning_resources where id = p_id and school_id = v_school;
    if not found then
      raise exception 'Resource not found.' using errcode = 'P0002';
    end if;
    if v_owner is distinct from v_actor and not auth_has_permission('academics.write') then
      raise exception 'You can only change your own material.' using errcode = '42501';
    end if;
    update public.learning_resources
       set stream_id = p_stream_id, subject_id = p_subject_id, kind = p_kind, title = btrim(p_title),
           body = case when p_kind = 'note' then btrim(p_body) end,
           url = case when p_kind <> 'note' then btrim(p_url) end,
           starts_at = p_starts_at, paper_year = p_paper_year, published = p_published, updated_at = now()
     where id = p_id and school_id = v_school
    returning id into v_id;
  end if;
  return v_id;
end;
$$;
revoke all on function public.save_learning_resource(uuid, uuid, uuid, text, text, text, text, timestamptz, integer, boolean) from public, anon;
grant execute on function public.save_learning_resource(uuid, uuid, uuid, text, text, text, text, timestamptz, integer, boolean) to authenticated;

create or replace function public.delete_learning_resource(p_id uuid)
returns void
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_school uuid := public.learning_guard();
  v_actor uuid;
  v_owner uuid;
begin
  select created_by into v_owner from public.learning_resources where id = p_id and school_id = v_school;
  if not found then
    raise exception 'Resource not found.' using errcode = 'P0002';
  end if;
  select id into v_actor from public.school_users
   where auth_user_id = auth.uid() and school_id = v_school and status = 'active' limit 1;
  if v_owner is distinct from v_actor and not auth_has_permission('academics.write') then
    raise exception 'You can only delete your own material.' using errcode = '42501';
  end if;
  delete from public.learning_resources where id = p_id and school_id = v_school;
end;
$$;
revoke all on function public.delete_learning_resource(uuid) from public, anon;
grant execute on function public.delete_learning_resource(uuid) to authenticated;

-- 7. Save a quiz. p_questions is a JSON array of {prompt, options[], correct_index, marks}.
--    On create it is required. On update, null leaves the questions untouched; once any attempt exists the
--    questions can no longer be replaced (close the quiz and make a new one).
create or replace function public.save_learning_quiz(
  p_id uuid,
  p_stream_id uuid,
  p_subject_id uuid,
  p_title text,
  p_description text,
  p_max_attempts integer,
  p_show_answers boolean,
  p_status text,
  p_questions jsonb
) returns uuid
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_school uuid := public.learning_guard();
  v_actor uuid;
  v_owner uuid;
  v_id uuid;
  v_old_stream uuid;
  v_q jsonb;
  v_qid uuid;
  v_pos integer := 0;
  v_n integer;
  v_has_attempts boolean := false;
  v_opts jsonb;
  v_opt jsonb;
begin
  if p_title is null or char_length(btrim(p_title)) not between 1 and 150
     or (p_description is not null and char_length(p_description) > 2000)
     or p_max_attempts is null or p_max_attempts not between 1 and 10
     or p_show_answers is null
     or p_status is null or p_status not in ('draft', 'published', 'closed') then
    raise exception 'Invalid quiz details.' using errcode = '22023';
  end if;
  if not exists (select 1 from public.streams where id = p_stream_id and school_id = v_school)
     or not exists (select 1 from public.subjects where id = p_subject_id and school_id = v_school) then
    raise exception 'Class or subject not found.' using errcode = 'P0002';
  end if;

  select id into v_actor from public.school_users
   where auth_user_id = auth.uid() and school_id = v_school and status = 'active' limit 1;

  if p_id is not null then
    select created_by, stream_id into v_owner, v_old_stream from public.learning_quizzes
     where id = p_id and school_id = v_school for update;
    if not found then
      raise exception 'Quiz not found.' using errcode = 'P0002';
    end if;
    if v_owner is distinct from v_actor and not auth_has_permission('academics.write') then
      raise exception 'You can only change your own quiz.' using errcode = '42501';
    end if;
    v_has_attempts := exists (select 1 from public.learning_quiz_attempts where quiz_id = p_id);
    if v_has_attempts and (p_questions is not null or p_stream_id <> v_old_stream) then
      raise exception 'This quiz already has attempts. Close it and create a new one to change the questions or class.' using errcode = '22023';
    end if;
  elsif p_questions is null then
    raise exception 'A new quiz needs questions.' using errcode = '22023';
  end if;

  -- Validate the questions before writing anything.
  if p_questions is not null then
    if jsonb_typeof(p_questions) <> 'array' or jsonb_array_length(p_questions) not between 1 and 50 then
      raise exception 'A quiz needs between 1 and 50 questions.' using errcode = '22023';
    end if;
    for v_q in select * from jsonb_array_elements(p_questions) loop
      v_opts := v_q -> 'options';
      if jsonb_typeof(v_q) <> 'object'
         or jsonb_typeof(v_q -> 'prompt') is distinct from 'string'
         or char_length(btrim(v_q ->> 'prompt')) not between 1 and 1000
         or jsonb_typeof(v_opts) is distinct from 'array'
         or jsonb_array_length(v_opts) not between 2 and 6
         or jsonb_typeof(v_q -> 'correct_index') is distinct from 'number'
         or (v_q ->> 'correct_index') !~ '^[0-9]+$'
         or (v_q ->> 'correct_index')::int >= jsonb_array_length(v_opts)
         or (jsonb_exists(v_q, 'marks') and (jsonb_typeof(v_q -> 'marks') is distinct from 'number'
              or (v_q ->> 'marks') !~ '^[0-9]+$' or (v_q ->> 'marks')::int not between 1 and 10)) then
        raise exception 'Question % is not valid.', v_pos + 1 using errcode = '22023';
      end if;
      for v_opt in select * from jsonb_array_elements(v_opts) loop
        if jsonb_typeof(v_opt) is distinct from 'string' or char_length(btrim(v_opt #>> '{}')) not between 1 and 200 then
          raise exception 'Question % has an empty or too long option.', v_pos + 1 using errcode = '22023';
        end if;
      end loop;
      v_pos := v_pos + 1;
    end loop;
    v_n := v_pos;
  else
    select count(*) into v_n from public.learning_quiz_questions where quiz_id = p_id;
  end if;

  if p_status = 'published' and v_n < 1 then
    raise exception 'Add at least one question before publishing.' using errcode = '22023';
  end if;

  if p_id is null then
    insert into public.learning_quizzes
      (school_id, stream_id, subject_id, title, description, max_attempts, show_answers, status, created_by)
    values (v_school, p_stream_id, p_subject_id, btrim(p_title), nullif(btrim(p_description), ''),
            p_max_attempts, p_show_answers, p_status, v_actor)
    returning id into v_id;
  else
    update public.learning_quizzes
       set stream_id = p_stream_id, subject_id = p_subject_id, title = btrim(p_title),
           description = nullif(btrim(p_description), ''), max_attempts = p_max_attempts,
           show_answers = p_show_answers, status = p_status, updated_at = now()
     where id = p_id and school_id = v_school
    returning id into v_id;
  end if;

  if p_questions is not null then
    delete from public.learning_quiz_questions where quiz_id = v_id;
    v_pos := 0;
    for v_q in select * from jsonb_array_elements(p_questions) loop
      v_pos := v_pos + 1;
      insert into public.learning_quiz_questions (school_id, quiz_id, position, prompt, options, marks)
      values (v_school, v_id, v_pos, btrim(v_q ->> 'prompt'), v_q -> 'options',
              coalesce((v_q ->> 'marks')::int, 1))
      returning id into v_qid;
      insert into public.learning_quiz_keys (question_id, school_id, correct_index)
      values (v_qid, v_school, (v_q ->> 'correct_index')::int);
    end loop;
  end if;
  return v_id;
end;
$$;
revoke all on function public.save_learning_quiz(uuid, uuid, uuid, text, text, integer, boolean, text, jsonb) from public, anon;
grant execute on function public.save_learning_quiz(uuid, uuid, uuid, text, text, integer, boolean, text, jsonb) to authenticated;

-- 8. Take a quiz. Marked here, never in the browser. p_answers is a JSON array with one entry per question:
--    the chosen option number (0-based) or null for unanswered.
create or replace function public.submit_learning_quiz(
  p_quiz_id uuid,
  p_student_id uuid,
  p_answers jsonb
) returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_school uuid := auth_school_id();
  v_uid uuid := auth.uid();
  v_actor uuid;
  v_quiz record;
  v_student record;
  v_n integer;
  v_used integer;
  v_score integer := 0;
  v_total integer := 0;
  v_attempt integer;
  v_review jsonb := '[]'::jsonb;
  r record;
  v_ans jsonb;
begin
  if v_school is null or v_uid is null then
    raise exception 'Not signed in.' using errcode = '42501';
  end if;
  if not public.school_has_feature_flag(v_school, 'feature.learning.portal') then
    raise exception 'The learning portal is not enabled for this school.' using errcode = '55000';
  end if;

  select id, stream_id, max_attempts, show_answers, status into v_quiz
    from public.learning_quizzes where id = p_quiz_id and school_id = v_school for update;
  if not found or v_quiz.status <> 'published' then
    raise exception 'Quiz not available.' using errcode = 'P0002';
  end if;

  select st.id, st.current_class_id, st.school_user_id into v_student
    from public.students st where st.id = p_student_id and st.school_id = v_school;
  if not found then
    raise exception 'Student not found.' using errcode = 'P0002';
  end if;
  -- Only the student's own login, or a guardian of that student, may submit for them.
  if not (
       auth_user_id_is_guardian_of(p_student_id)
       or exists (select 1 from public.school_users su where su.id = v_student.school_user_id and su.auth_user_id = v_uid and su.status = 'active')
     ) then
    raise exception 'You cannot take this quiz for that student.' using errcode = '42501';
  end if;
  if v_student.current_class_id is distinct from v_quiz.stream_id then
    raise exception 'This quiz is for a different class.' using errcode = '42501';
  end if;

  select count(*) into v_n from public.learning_quiz_questions where quiz_id = p_quiz_id;
  if p_answers is null or jsonb_typeof(p_answers) <> 'array' or jsonb_array_length(p_answers) <> v_n then
    raise exception 'Send one answer for every question.' using errcode = '22023';
  end if;

  select count(*) into v_used from public.learning_quiz_attempts where quiz_id = p_quiz_id and student_id = p_student_id;
  if v_used >= v_quiz.max_attempts then
    raise exception 'No attempts left on this quiz.' using errcode = '22023';
  end if;
  v_attempt := v_used + 1;

  for r in
    select q.position, q.marks, jsonb_array_length(q.options) as opts, k.correct_index
      from public.learning_quiz_questions q
      join public.learning_quiz_keys k on k.question_id = q.id
     where q.quiz_id = p_quiz_id
     order by q.position
  loop
    v_ans := p_answers -> (r.position - 1);
    if jsonb_typeof(v_ans) = 'null' then
      null;
    elsif jsonb_typeof(v_ans) <> 'number' or (v_ans #>> '{}') !~ '^[0-9]+$' or (v_ans #>> '{}')::int >= r.opts then
      raise exception 'Answer % is not valid.', r.position using errcode = '22023';
    end if;
    v_total := v_total + r.marks;
    if jsonb_typeof(v_ans) = 'number' and (v_ans #>> '{}')::int = r.correct_index then
      v_score := v_score + r.marks;
    end if;
    if v_quiz.show_answers then
      v_review := v_review || jsonb_build_object(
        'position', r.position,
        'correct_index', r.correct_index,
        'your_answer', case when jsonb_typeof(v_ans) = 'number' then v_ans else 'null'::jsonb end
      );
    end if;
  end loop;

  select id into v_actor from public.school_users where auth_user_id = v_uid and school_id = v_school and status = 'active' limit 1;
  insert into public.learning_quiz_attempts (school_id, quiz_id, student_id, attempt_no, answers, score, total, submitted_by)
  values (v_school, p_quiz_id, p_student_id, v_attempt, p_answers, v_score, v_total, v_actor);

  return jsonb_build_object(
    'attempt_no', v_attempt,
    'score', v_score,
    'total', v_total,
    'attempts_left', v_quiz.max_attempts - v_attempt,
    'review', case when v_quiz.show_answers then v_review else null end
  );
end;
$$;
revoke all on function public.submit_learning_quiz(uuid, uuid, jsonb) from public, anon;
grant execute on function public.submit_learning_quiz(uuid, uuid, jsonb) to authenticated;
