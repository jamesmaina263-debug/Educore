-- Phase 8.2 (3/3): AI tutor, learner question-and-answer ("Option B"), database core. Additive only; ships dark.
--
-- What this is: a learner (or a parent for their child) types a short question about a subject; the app answers ONLY
-- from the APPROVED study guides of that learner's own class (part 2), or says "ask your teacher". Design and risk
-- review: docs/designs/wp-8-2-part-3-learner-qa.md. Nothing here calls an AI or sends a message.
--
-- * New flag feature.learning.ai_tutor_qa (off for everyone). Also requires feature.learning.portal and ai_tutor.
-- * SECOND LOCK, in the database: even with the flag on, nothing works for a school until its owner or principal has
--   recorded, in tutor_qa_school_settings, (a) a safeguarding contact (active non-parent staff member), (b) that a data
--   protection impact assessment is done, and (c) that parents have been given notice. tutor_qa_ready() checks all of it.
-- * tutor_qa_questions: the question (already filtered by the app), the answer, the guides it cited, a review state for
--   safeguarding hits. Written only by save_tutor_qa(); no write policies. Rows expire (default 90 days) and are
--   hidden by RLS immediately and deleted lazily (every save, and tutor_qa_purge()).
-- * Deliberately NO audit trigger on tutor_qa_questions: audit_log is append-only and would keep a copy of a child's
--   question forever, defeating the retention limit. The settings table IS audited (it holds no child data).
-- * A daily per-learner limit (default 10) is enforced here, not trusted from the browser.
-- Rollback: switch the flag off (reads return nothing, functions refuse). Nothing existing depends on these objects.

insert into public.platform_feature_flags (key, label, description)
select 'feature.learning.ai_tutor_qa',
       'AI tutor: learner questions (from approved guides only)',
       'Learners and parents can ask short questions answered only from the class''s teacher-approved study guides. Teachers see every question. Needs the learning portal and the AI tutor, and the school must first record a safeguarding contact, a data protection impact assessment and a parent notice. Off by default.'
where not exists (select 1 from public.platform_feature_flags where lower(key) = 'feature.learning.ai_tutor_qa');

-- 1. Per-school confirmations (the second lock).
create table if not exists public.tutor_qa_school_settings (
  school_id uuid primary key references public.schools(id) on delete cascade,
  safeguarding_contact_id uuid references public.school_users(id) on delete set null,
  dpia_confirmed_at timestamptz,
  parent_notice_confirmed_at timestamptz,
  confirmed_by uuid references public.school_users(id) on delete set null,
  retention_days integer not null default 90 check (retention_days between 30 and 365),
  daily_question_limit integer not null default 10 check (daily_question_limit between 1 and 30),
  updated_at timestamptz not null default now()
);
comment on table public.tutor_qa_school_settings is
  'Per-school confirmations required before learner questions work. Written only by tutor_qa_configure(). Holds no child data.';
alter table public.tutor_qa_school_settings enable row level security;
drop policy if exists tutor_qa_settings_select on public.tutor_qa_school_settings;
create policy tutor_qa_settings_select on public.tutor_qa_school_settings for select
  using (school_id = auth_school_id() and auth_has_permission('academics.read'));
revoke insert, update, delete on public.tutor_qa_school_settings from anon, authenticated;
drop trigger if exists trg_audit_tutor_qa_settings on public.tutor_qa_school_settings;
create trigger trg_audit_tutor_qa_settings
  after insert or update or delete on public.tutor_qa_school_settings
  for each row execute function public.audit_row_change();

-- 2. Readiness: flags AND confirmations. Service-side only (definer functions and the app's own wrapper below use it).
create or replace function public.tutor_qa_ready(p_school uuid)
returns boolean
language sql
stable
security definer
set search_path to 'public'
as $$
  select coalesce(public.school_has_feature_flag(p_school, 'feature.learning.portal'), false)
     and coalesce(public.school_has_feature_flag(p_school, 'feature.learning.ai_tutor'), false)
     and coalesce(public.school_has_feature_flag(p_school, 'feature.learning.ai_tutor_qa'), false)
     and exists (
       select 1 from public.tutor_qa_school_settings s
        where s.school_id = p_school
          and s.safeguarding_contact_id is not null
          and s.dpia_confirmed_at is not null
          and s.parent_notice_confirmed_at is not null
     );
$$;
revoke all on function public.tutor_qa_ready(uuid) from public, anon, authenticated;

-- The signed-in user's own school: ready or not (the app uses this to show or hide the question box).
create or replace function public.tutor_qa_my_ready()
returns boolean
language sql
stable
security definer
set search_path to 'public'
as $$
  select auth_school_id() is not null and public.tutor_qa_ready(auth_school_id());
$$;
revoke all on function public.tutor_qa_my_ready() from public, anon;
grant execute on function public.tutor_qa_my_ready() to authenticated;

-- 3. Owner / principal records the confirmations. Turning one off clears it (and so switches the feature off).
create or replace function public.tutor_qa_configure(p_contact uuid, p_dpia boolean, p_notice boolean)
returns void
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_school uuid := auth_school_id();
  v_actor uuid;
begin
  if v_school is null then
    raise exception 'Not authorized.' using errcode = '42501';
  end if;
  select su.id into v_actor
    from public.school_users su join public.roles r on r.id = su.role_id
   where su.auth_user_id = auth.uid() and su.school_id = v_school and su.status = 'active'
     and r.name in ('school_owner', 'principal')
   limit 1;
  if v_actor is null then
    raise exception 'Only the school owner or principal can set this up.' using errcode = '42501';
  end if;
  if not public.school_has_feature_flag(v_school, 'feature.learning.ai_tutor_qa') then
    raise exception 'Learner questions are not enabled for this school.' using errcode = '55000';
  end if;
  if p_contact is not null and not exists (
    select 1 from public.school_users su join public.roles r on r.id = su.role_id
     where su.id = p_contact and su.school_id = v_school and su.status = 'active'
       and r.name not in ('parent', 'student')
  ) then
    raise exception 'The safeguarding contact must be an active staff member of this school.' using errcode = '22023';
  end if;
  insert into public.tutor_qa_school_settings as s (school_id, safeguarding_contact_id, dpia_confirmed_at, parent_notice_confirmed_at, confirmed_by, updated_at)
  values (v_school, p_contact, case when p_dpia then now() end, case when p_notice then now() end, v_actor, now())
  on conflict (school_id) do update set
    safeguarding_contact_id = excluded.safeguarding_contact_id,
    dpia_confirmed_at = case when p_dpia then coalesce(s.dpia_confirmed_at, now()) end,
    parent_notice_confirmed_at = case when p_notice then coalesce(s.parent_notice_confirmed_at, now()) end,
    confirmed_by = excluded.confirmed_by,
    updated_at = now();
end;
$$;
revoke all on function public.tutor_qa_configure(uuid, boolean, boolean) from public, anon;
grant execute on function public.tutor_qa_configure(uuid, boolean, boolean) to authenticated;

-- 4. Questions.
create table if not exists public.tutor_qa_questions (
  id uuid primary key default gen_random_uuid(),
  school_id uuid not null references public.schools(id) on delete cascade,
  student_id uuid not null references public.students(id) on delete cascade,
  asked_by uuid not null references public.school_users(id) on delete cascade,
  stream_id uuid not null references public.streams(id) on delete cascade,
  idempotency_key text not null check (char_length(idempotency_key) between 8 and 80),
  question text not null check (char_length(btrim(question)) between 1 and 300),
  status text not null check (status in ('answered', 'not_covered', 'blocked_personal', 'safeguarding')),
  answer text check (answer is null or char_length(btrim(answer)) between 1 and 1500),
  cited_draft_ids uuid[] not null default '{}',
  review_status text not null default 'none' check (review_status in ('none', 'new', 'reviewed')),
  reviewed_by uuid references public.school_users(id) on delete set null,
  reviewed_at timestamptz,
  model text check (model is null or char_length(model) <= 80),
  prompt_version text check (prompt_version is null or char_length(prompt_version) <= 40),
  prompt_tokens integer check (prompt_tokens is null or prompt_tokens >= 0),
  output_tokens integer check (output_tokens is null or output_tokens >= 0),
  created_at timestamptz not null default now(),
  expires_at timestamptz not null,
  unique (asked_by, idempotency_key),
  constraint tutor_qa_questions_shape check (
    (status = 'answered' and answer is not null and cardinality(cited_draft_ids) between 1 and 5)
    or (status <> 'answered' and answer is null and cardinality(cited_draft_ids) = 0)
  ),
  constraint tutor_qa_questions_review_shape check (
    (status = 'safeguarding' and review_status in ('new', 'reviewed'))
    or (status <> 'safeguarding' and review_status = 'none')
  )
);
comment on table public.tutor_qa_questions is
  'Learner/parent questions to the AI tutor and the answers. Written only by save_tutor_qa(). Expires per tutor_qa_school_settings.retention_days. No audit trigger on purpose (audit_log is append-only).';
create index if not exists tutor_qa_questions_student on public.tutor_qa_questions (school_id, student_id, created_at desc);
create index if not exists tutor_qa_questions_review on public.tutor_qa_questions (school_id, review_status) where review_status = 'new';
create index if not exists tutor_qa_questions_expiry on public.tutor_qa_questions (expires_at);
alter table public.tutor_qa_questions enable row level security;
revoke insert, update, delete on public.tutor_qa_questions from anon, authenticated;

drop policy if exists tutor_qa_questions_select on public.tutor_qa_questions;
create policy tutor_qa_questions_select on public.tutor_qa_questions for select
  using (
    school_id = auth_school_id()
    and expires_at > now()
    and public.my_school_has_feature_flag('feature.learning.ai_tutor_qa')
    and (
      auth_has_permission('academics.read')
      or exists (select 1 from public.school_users su where su.id = tutor_qa_questions.asked_by and su.auth_user_id = auth.uid())
    )
  );

-- 5. Who is asking, and for which learner (internal; parent of the child, or the learner's own account).
create or replace function public.tutor_qa_resolve(p_student uuid)
returns table (school_id uuid, stream_id uuid, asker uuid)
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_school uuid := auth_school_id();
  v_su uuid;
  v_role text;
  v_stream uuid;
  v_ok boolean := false;
begin
  if v_school is null or p_student is null then
    raise exception 'Not authorized.' using errcode = '42501';
  end if;
  select su.id, r.name into v_su, v_role
    from public.school_users su join public.roles r on r.id = su.role_id
   where su.auth_user_id = auth.uid() and su.school_id = v_school and su.status = 'active'
   limit 1;
  if v_su is null or v_role not in ('parent', 'student') then
    raise exception 'Not authorized.' using errcode = '42501';
  end if;
  select st.current_class_id into v_stream from public.students st where st.id = p_student and st.school_id = v_school;
  if v_role = 'parent' then
    v_ok := exists (select 1 from public.student_guardians sg where sg.guardian_user_id = v_su and sg.student_id = p_student);
  else
    v_ok := exists (select 1 from public.students st where st.id = p_student and st.school_user_id = v_su);
  end if;
  if not v_ok or v_stream is null then
    raise exception 'Not authorized.' using errcode = '42501';
  end if;
  return query select v_school, v_stream, v_su;
end;
$$;
revoke all on function public.tutor_qa_resolve(uuid) from public, anon, authenticated;

-- Internal: is the learner under today's limit (Nairobi calendar day)?
create or replace function public.tutor_qa_under_limit(p_school uuid, p_student uuid)
returns boolean
language sql
stable
security definer
set search_path to 'public'
as $$
  select (
    select count(*) from public.tutor_qa_questions q
     where q.school_id = p_school and q.student_id = p_student
       and (q.created_at at time zone 'Africa/Nairobi')::date = (now() at time zone 'Africa/Nairobi')::date
  ) < coalesce((select s.daily_question_limit from public.tutor_qa_school_settings s where s.school_id = p_school), 10);
$$;
revoke all on function public.tutor_qa_under_limit(uuid, uuid) from public, anon, authenticated;

-- 6. Before the app spends anything: is this caller allowed to ask for this learner, and may they ask now? Returns the stream.
create or replace function public.tutor_qa_check(p_student uuid)
returns uuid
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  r record;
begin
  select * into r from public.tutor_qa_resolve(p_student);
  if not public.tutor_qa_ready(r.school_id) then
    raise exception 'Questions are not switched on for this school.' using errcode = '55000';
  end if;
  if not public.tutor_qa_under_limit(r.school_id, p_student) then
    raise exception 'Daily question limit reached.' using errcode = '54000';
  end if;
  return r.stream_id;
end;
$$;
revoke all on function public.tutor_qa_check(uuid) from public, anon;
grant execute on function public.tutor_qa_check(uuid) to authenticated;

-- 7. Save one exchange. Re-checks everything; the cited guides must be approved, current guides of the learner's class.
create or replace function public.save_tutor_qa(
  p_student uuid, p_key text, p_question text, p_status text, p_answer text, p_cited uuid[],
  p_model text, p_prompt_version text, p_prompt_tokens integer, p_output_tokens integer)
returns uuid
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  r record;
  v_id uuid;
  v_days integer;
  v_cited uuid[] := coalesce(p_cited, '{}');
  v_good integer;
  v_q text;
begin
  select * into r from public.tutor_qa_resolve(p_student);
  if not public.tutor_qa_ready(r.school_id) then
    raise exception 'Questions are not switched on for this school.' using errcode = '55000';
  end if;
  if p_key is null or char_length(p_key) not between 8 and 80
     or p_question is null or char_length(btrim(p_question)) not between 1 and 300
     or p_status not in ('answered', 'not_covered', 'blocked_personal', 'safeguarding') then
    raise exception 'Invalid question.' using errcode = '22023';
  end if;
  -- idempotent retry: same asker + key returns the saved row
  select id into v_id from public.tutor_qa_questions where asked_by = r.asker and idempotency_key = p_key;
  if v_id is not null then
    return v_id;
  end if;
  if not public.tutor_qa_under_limit(r.school_id, p_student) then
    raise exception 'Daily question limit reached.' using errcode = '54000';
  end if;
  if p_status = 'answered' then
    if p_answer is null or char_length(btrim(p_answer)) not between 1 and 1500 or cardinality(v_cited) not between 1 and 5 then
      raise exception 'Invalid answer.' using errcode = '22023';
    end if;
    select count(*) into v_good from public.tutor_drafts d
     where d.id = any (v_cited) and d.school_id = r.school_id and d.stream_id = r.stream_id and d.status = 'approved'
       and (select count(*) from public.learning_resources lr
             where lr.id = any (d.source_resource_ids) and lr.kind = 'note' and lr.published and lr.updated_at <= d.created_at)
           = cardinality(d.source_resource_ids);
    if v_good <> (select count(distinct x) from unnest(v_cited) x) then
      raise exception 'The answer cites a guide that is not available to this class.' using errcode = '22023';
    end if;
  elsif p_answer is not null or cardinality(v_cited) <> 0 then
    raise exception 'Invalid answer.' using errcode = '22023';
  end if;

  -- safety net: never store an email address or a long digit run (phone, ID), whatever the app sent
  v_q := regexp_replace(regexp_replace(btrim(p_question), '[[:alnum:]._%+-]+@[[:alnum:].-]+', '[email]', 'g'), '[0-9][0-9 +()-]{5,}[0-9]', '[number]', 'g');
  select coalesce((select s.retention_days from public.tutor_qa_school_settings s where s.school_id = r.school_id), 90) into v_days;
  -- lazy purge of this school's expired rows
  delete from public.tutor_qa_questions where school_id = r.school_id and expires_at < now();

  insert into public.tutor_qa_questions (school_id, student_id, asked_by, stream_id, idempotency_key, question, status, answer,
                                         cited_draft_ids, review_status, model, prompt_version, prompt_tokens, output_tokens, expires_at)
  values (r.school_id, p_student, r.asker, r.stream_id, p_key, left(v_q, 300), p_status, nullif(btrim(coalesce(p_answer, '')), ''),
          (select coalesce(array_agg(distinct x), '{}') from unnest(v_cited) x),
          case when p_status = 'safeguarding' then 'new' else 'none' end,
          left(p_model, 80), left(p_prompt_version, 40), p_prompt_tokens, p_output_tokens, now() + make_interval(days => v_days))
  returning id into v_id;
  return v_id;
end;
$$;
revoke all on function public.save_tutor_qa(uuid, text, text, text, text, uuid[], text, text, integer, integer) from public, anon;
grant execute on function public.save_tutor_qa(uuid, text, text, text, text, uuid[], text, text, integer, integer) to authenticated;

-- 8. A teacher (or the safeguarding contact) marks a flagged question as followed up. Raises if nothing changed.
create or replace function public.tutor_qa_review(p_id uuid)
returns void
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_school uuid := auth_school_id();
  v_actor uuid;
  v_contact uuid;
  v_n integer;
begin
  if v_school is null or not public.tutor_qa_ready(v_school) then
    raise exception 'Questions are not switched on for this school.' using errcode = '55000';
  end if;
  select su.id into v_actor from public.school_users su
   where su.auth_user_id = auth.uid() and su.school_id = v_school and su.status = 'active' limit 1;
  select s.safeguarding_contact_id into v_contact from public.tutor_qa_school_settings s where s.school_id = v_school;
  if v_actor is null or not (auth_has_permission('academics.write') or v_actor = v_contact) then
    raise exception 'Not authorized.' using errcode = '42501';
  end if;
  update public.tutor_qa_questions
     set review_status = 'reviewed', reviewed_by = v_actor, reviewed_at = now()
   where id = p_id and school_id = v_school and review_status = 'new';
  get diagnostics v_n = row_count;
  if v_n = 0 then
    raise exception 'Nothing to review.' using errcode = 'P0002';
  end if;
end;
$$;
revoke all on function public.tutor_qa_review(uuid) from public, anon;
grant execute on function public.tutor_qa_review(uuid) to authenticated;

-- 9. Purge (for a later scheduled job; also runs lazily on every save).
create or replace function public.tutor_qa_purge()
returns integer
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_n integer;
begin
  delete from public.tutor_qa_questions where expires_at < now();
  get diagnostics v_n = row_count;
  return v_n;
end;
$$;
revoke all on function public.tutor_qa_purge() from public, anon, authenticated;
grant execute on function public.tutor_qa_purge() to service_role;
