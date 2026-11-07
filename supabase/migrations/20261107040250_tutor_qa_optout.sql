-- Phase 8.2 (3/3) follow-up: per-learner opt-out and deletion for the AI tutor's learner questions. Additive; dark.
--
-- Why: the parent notice and the DPIA (docs/legal/) promise that a family can stop their child using the question helper and
-- can have the child's questions deleted. Until now only a whole-school switch existed.
--   * tutor_qa_opt_outs: one row per opted-out learner (no child text; audited: who switched it off and when).
--   * tutor_qa_set_opt_out(student, bool): the learner's own account (switch OFF only, never back on), a linked parent/guardian, or staff with academics.write
--     (acting on a family's request) in the same school. Switching OFF is allowed at any time, whatever the flags say.
--   * tutor_qa_opt_out_status(student): same people may read it.
--   * tutor_qa_delete_questions(student): same people; deletes the learner's stored questions EXCEPT unreviewed safeguarding
--     flags (a worrying message must not vanish before a member of staff has seen it); returns how many were deleted and kept.
--   * tutor_qa_check() and save_tutor_qa() (this feature's own functions, not yet used by any school) now refuse with
--     SQLSTATE TQ001 for an opted-out learner, so the rule holds even if a screen forgets it.
-- Rollback: drop the table and functions and re-run the earlier definitions of tutor_qa_check/save_tutor_qa (migration 20261106043402).

create table if not exists public.tutor_qa_opt_outs (
  id uuid primary key default gen_random_uuid(), -- audit_row_change() expects an id column
  school_id uuid not null references public.schools(id) on delete cascade,
  student_id uuid not null unique references public.students(id) on delete cascade,
  opted_out_by uuid references public.school_users(id) on delete set null,
  created_at timestamptz not null default now()
);
comment on table public.tutor_qa_opt_outs is 'Learners whose family has switched off AI tutor questions. Written only by tutor_qa_set_opt_out(). Holds no question text.';
alter table public.tutor_qa_opt_outs enable row level security;
drop policy if exists tutor_qa_opt_outs_select on public.tutor_qa_opt_outs;
create policy tutor_qa_opt_outs_select on public.tutor_qa_opt_outs for select
  using (school_id = auth_school_id() and auth_has_permission('academics.read'));
revoke insert, update, delete on public.tutor_qa_opt_outs from anon, authenticated;
drop trigger if exists trg_audit_tutor_qa_opt_outs on public.tutor_qa_opt_outs;
create trigger trg_audit_tutor_qa_opt_outs
  after insert or update or delete on public.tutor_qa_opt_outs
  for each row execute function public.audit_row_change();

-- Who may manage a learner's setting: the learner's own account, a linked parent or guardian, or school staff who can write
-- academic records. Internal helper.
create or replace function public.tutor_qa_manage_scope(p_student uuid)
returns table (school_id uuid, actor uuid, actor_role text)
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_school uuid := auth_school_id();
  v_su uuid;
  v_role text;
  v_ok boolean := false;
begin
  if v_school is null or p_student is null then
    raise exception 'Not authorized.' using errcode = '42501';
  end if;
  select su.id, r.name into v_su, v_role
    from public.school_users su join public.roles r on r.id = su.role_id
   where su.auth_user_id = auth.uid() and su.school_id = v_school and su.status = 'active'
   limit 1;
  if v_su is null or not exists (select 1 from public.students st where st.id = p_student and st.school_id = v_school) then
    raise exception 'Not authorized.' using errcode = '42501';
  end if;
  if v_role = 'parent' then
    v_ok := exists (select 1 from public.student_guardians sg where sg.guardian_user_id = v_su and sg.student_id = p_student);
  elsif v_role = 'student' then
    v_ok := exists (select 1 from public.students st where st.id = p_student and st.school_user_id = v_su);
  else
    v_ok := auth_has_permission('academics.write');
  end if;
  if not v_ok then
    raise exception 'Not authorized.' using errcode = '42501';
  end if;
  return query select v_school, v_su, v_role;
end;
$$;
revoke all on function public.tutor_qa_manage_scope(uuid) from public, anon, authenticated;

create or replace function public.tutor_qa_set_opt_out(p_student uuid, p_opt_out boolean)
returns void
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  r record;
begin
  select * into r from public.tutor_qa_manage_scope(p_student);
  -- a learner may switch questions OFF for themselves but not back ON: that is for a parent, guardian or the school
  if r.actor_role = 'student' and p_opt_out is not true then
    raise exception 'Ask a parent or the school to switch questions back on.' using errcode = '42501';
  end if;
  if p_opt_out is true then
    insert into public.tutor_qa_opt_outs (school_id, student_id, opted_out_by) values (r.school_id, p_student, r.actor)
    on conflict (student_id) do nothing;
  else
    delete from public.tutor_qa_opt_outs where student_id = p_student and school_id = r.school_id;
  end if;
end;
$$;
revoke all on function public.tutor_qa_set_opt_out(uuid, boolean) from public, anon;
grant execute on function public.tutor_qa_set_opt_out(uuid, boolean) to authenticated;

create or replace function public.tutor_qa_opt_out_status(p_student uuid)
returns boolean
language plpgsql
stable
security definer
set search_path to 'public'
as $$
declare
  r record;
begin
  select * into r from public.tutor_qa_manage_scope(p_student);
  return exists (select 1 from public.tutor_qa_opt_outs o where o.student_id = p_student and o.school_id = r.school_id);
end;
$$;
revoke all on function public.tutor_qa_opt_out_status(uuid) from public, anon;
grant execute on function public.tutor_qa_opt_out_status(uuid) to authenticated;

create or replace function public.tutor_qa_delete_questions(p_student uuid)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  r record;
  v_deleted integer;
  v_kept integer;
begin
  select * into r from public.tutor_qa_manage_scope(p_student);
  delete from public.tutor_qa_questions where student_id = p_student and school_id = r.school_id and review_status <> 'new';
  get diagnostics v_deleted = row_count;
  select count(*) into v_kept from public.tutor_qa_questions where student_id = p_student and school_id = r.school_id;
  return jsonb_build_object('deleted', v_deleted, 'kept_for_safeguarding', v_kept);
end;
$$;
revoke all on function public.tutor_qa_delete_questions(uuid) from public, anon;
grant execute on function public.tutor_qa_delete_questions(uuid) to authenticated;

-- The two functions from migration 20261106043402, with the opt-out refusal added (nothing else changed).
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
  if exists (select 1 from public.tutor_qa_opt_outs o where o.student_id = p_student) then
    raise exception 'Questions are switched off for this learner.' using errcode = 'TQ001';
  end if;
  if not public.tutor_qa_under_limit(r.school_id, p_student) then
    raise exception 'Daily question limit reached.' using errcode = '54000';
  end if;
  return r.stream_id;
end;
$$;

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
  if exists (select 1 from public.tutor_qa_opt_outs o where o.student_id = p_student) then
    raise exception 'Questions are switched off for this learner.' using errcode = 'TQ001';
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
  -- the limit never blocks recording a safeguarding hit: a child in trouble must always be flagged
  if p_status <> 'safeguarding' and not public.tutor_qa_under_limit(r.school_id, p_student) then
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
