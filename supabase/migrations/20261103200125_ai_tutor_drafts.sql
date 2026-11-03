-- Phase 8.2 (1/3): AI tutor, database core. Additive only; ships dark. Depends on 8.1 (learning portal lite).
--
-- What this is: a TEACHER asks the AI for a study guide for one class + subject, grounded ONLY in that class's
-- published NOTES (text) from the learning portal. The result is saved as a DRAFT with the notes it came from. Only
-- after a teacher approves it can learners and parents of that class see it, with its sources listed.
--
-- Deliberately NOT in this package: any free-form chat for learners or parents. Learners only read approved,
-- sourced, teacher-reviewed text.
--
-- * New flag feature.learning.ai_tutor (catalog entry, enabled for nobody). Also requires feature.learning.portal.
-- * tutor_drafts: no direct write policies. Everything goes through the SECURITY DEFINER functions below, which
--   re-check the flags, the caller and the sources every time.
-- * Grounding is enforced here, not trusted from the browser: a draft must cite 1-20 PUBLISHED NOTES of the same
--   school, class and subject; the source list and titles are copied from the database.
-- * A source note that is later unpublished, deleted OR edited stops the draft being shown to learners (and blocks
--   approving it), so approved text never outlives the material it was written from.
-- * tutor_ai_requests: idempotency claim + audit of each generation (who, when, how long, tokens, outcome).
-- * Sends nothing (no SMS, email, WhatsApp or push), takes no payment, touches no existing table.
-- Rollback: switch the flag off (reads return nothing, functions refuse). Nothing existing depends on these objects.

insert into public.platform_feature_flags (key, label, description)
select 'feature.learning.ai_tutor',
       'AI tutor (teacher-approved study guides)',
       'Teachers draft study guides with AI from the class''s published notes, review and approve them; learners see approved guides with their sources. Needs the learning portal. Off by default.'
where not exists (
  select 1 from public.platform_feature_flags where lower(key) = 'feature.learning.ai_tutor'
);

-- Staff guard: academics.read in their own school, BOTH flags on. Returns the school id.
create or replace function public.tutor_guard()
returns uuid
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_school uuid := auth_school_id();
begin
  if v_school is null or not auth_has_permission('academics.read') then
    raise exception 'Not authorized to manage tutor drafts.' using errcode = '42501';
  end if;
  if not public.school_has_feature_flag(v_school, 'feature.learning.portal')
     or not public.school_has_feature_flag(v_school, 'feature.learning.ai_tutor') then
    raise exception 'The AI tutor is not enabled for this school.' using errcode = '55000';
  end if;
  return v_school;
end;
$$;
revoke all on function public.tutor_guard() from public, anon, authenticated;

-- Drafts.
create table if not exists public.tutor_drafts (
  id uuid primary key default gen_random_uuid(),
  school_id uuid not null references public.schools(id) on delete cascade,
  stream_id uuid not null references public.streams(id) on delete cascade,
  subject_id uuid not null references public.subjects(id) on delete cascade,
  title text not null check (char_length(btrim(title)) between 1 and 150),
  body text not null check (char_length(btrim(body)) between 1 and 12000),
  source_resource_ids uuid[] not null check (cardinality(source_resource_ids) between 1 and 20),
  source_snapshot jsonb not null check (jsonb_typeof(source_snapshot) = 'array'),
  status text not null default 'draft' check (status in ('draft', 'approved', 'rejected')),
  model text check (model is null or char_length(model) <= 80),
  prompt_version text not null check (char_length(prompt_version) between 1 and 40),
  created_by uuid references public.school_users(id) on delete set null,
  reviewed_by uuid references public.school_users(id) on delete set null,
  reviewed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint tutor_drafts_review_shape check (
    (status = 'draft' and reviewed_by is null and reviewed_at is null)
    or (status in ('approved', 'rejected') and reviewed_at is not null)
  )
);
comment on table public.tutor_drafts is
  'AI-drafted study guides grounded in published notes. Written only by save_tutor_draft / update_tutor_draft / review_tutor_draft. Learners see approved drafts whose source notes are all still published and unchanged.';
create index if not exists tutor_drafts_stream on public.tutor_drafts (school_id, stream_id, subject_id);
alter table public.tutor_drafts enable row level security;

drop policy if exists tutor_drafts_select on public.tutor_drafts;
create policy tutor_drafts_select on public.tutor_drafts for select
  using (
    public.learning_can_see_stream(school_id, stream_id)
    and public.my_school_has_feature_flag('feature.learning.ai_tutor')
    and (
      public.learning_is_staff()
      or (
        status = 'approved'
        -- every source note must still exist, be published, and be unchanged since the draft was written
        and (
          select count(*) from public.learning_resources r
           where r.id = any (tutor_drafts.source_resource_ids)
             and r.kind = 'note' and r.published and r.updated_at <= tutor_drafts.created_at
        ) = cardinality(tutor_drafts.source_resource_ids)
      )
    )
  );

drop trigger if exists trg_audit_tutor_drafts on public.tutor_drafts;
create trigger trg_audit_tutor_drafts
  after insert or update or delete on public.tutor_drafts
  for each row execute function public.audit_row_change();

-- Generation requests: idempotency claim + audit.
create table if not exists public.tutor_ai_requests (
  id uuid primary key default gen_random_uuid(),
  school_id uuid not null references public.schools(id) on delete cascade,
  requested_by uuid not null references public.school_users(id) on delete cascade,
  idempotency_key text not null check (char_length(idempotency_key) between 8 and 80),
  prompt_version text not null,
  status text not null default 'started' check (status in ('started', 'succeeded', 'failed')),
  failure_category text check (failure_category is null or char_length(failure_category) <= 60),
  duration_ms integer check (duration_ms is null or duration_ms >= 0),
  prompt_tokens integer check (prompt_tokens is null or prompt_tokens >= 0),
  output_tokens integer check (output_tokens is null or output_tokens >= 0),
  draft_id uuid references public.tutor_drafts(id) on delete set null,
  created_at timestamptz not null default now(),
  completed_at timestamptz,
  unique (requested_by, idempotency_key)
);
comment on table public.tutor_ai_requests is 'One row per AI generation attempt. Written only by claim_tutor_request / finish_tutor_request.';
alter table public.tutor_ai_requests enable row level security;
drop policy if exists tutor_ai_requests_select on public.tutor_ai_requests;
create policy tutor_ai_requests_select on public.tutor_ai_requests for select
  using (
    school_id = auth_school_id()
    and public.my_school_has_feature_flag('feature.learning.ai_tutor')
    and (
      auth_has_permission('academics.write')
      or exists (select 1 from public.school_users su where su.id = tutor_ai_requests.requested_by and su.auth_user_id = auth.uid())
    )
  );

create or replace function public.claim_tutor_request(p_key text, p_prompt_version text)
returns uuid
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_school uuid := public.tutor_guard();
  v_actor uuid;
  v_id uuid;
begin
  select id into v_actor from public.school_users
   where auth_user_id = auth.uid() and school_id = v_school and status = 'active' limit 1;
  if v_actor is null then
    raise exception 'Not authorized to manage tutor drafts.' using errcode = '42501';
  end if;
  insert into public.tutor_ai_requests (school_id, requested_by, idempotency_key, prompt_version)
  values (v_school, v_actor, p_key, p_prompt_version)
  returning id into v_id;
  return v_id;
exception when unique_violation then
  raise exception 'This request was already submitted.' using errcode = '23505';
end;
$$;
revoke all on function public.claim_tutor_request(text, text) from public, anon;
grant execute on function public.claim_tutor_request(text, text) to authenticated;

create or replace function public.finish_tutor_request(
  p_id uuid, p_status text, p_failure text, p_ms integer, p_prompt_tokens integer, p_output_tokens integer, p_draft_id uuid
) returns void
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_school uuid := public.tutor_guard();
begin
  if p_status not in ('succeeded', 'failed') then
    raise exception 'Invalid status.' using errcode = '22023';
  end if;
  update public.tutor_ai_requests r
     set status = p_status, failure_category = left(p_failure, 60), duration_ms = p_ms,
         prompt_tokens = p_prompt_tokens, output_tokens = p_output_tokens, draft_id = p_draft_id, completed_at = now()
   where r.id = p_id and r.school_id = v_school
     and r.status = 'started'
     and exists (select 1 from public.school_users su where su.id = r.requested_by and su.auth_user_id = auth.uid());
  if not found then
    raise exception 'Request not found.' using errcode = 'P0002';
  end if;
end;
$$;
revoke all on function public.finish_tutor_request(uuid, text, text, integer, integer, integer, uuid) from public, anon;
grant execute on function public.finish_tutor_request(uuid, text, text, integer, integer, integer, uuid) to authenticated;

-- Save a generated draft. The sources are validated and snapshotted HERE from the database.
create or replace function public.save_tutor_draft(
  p_stream_id uuid, p_subject_id uuid, p_title text, p_body text,
  p_source_ids uuid[], p_model text, p_prompt_version text
) returns uuid
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_school uuid := public.tutor_guard();
  v_actor uuid;
  v_ids uuid[];
  v_found integer;
  v_snapshot jsonb;
  v_id uuid;
begin
  if p_title is null or char_length(btrim(p_title)) not between 1 and 150
     or p_body is null or char_length(btrim(p_body)) not between 1 and 12000
     or p_prompt_version is null or char_length(p_prompt_version) not between 1 and 40
     or (p_model is not null and char_length(p_model) > 80) then
    raise exception 'Invalid tutor draft.' using errcode = '22023';
  end if;
  select coalesce(array_agg(distinct x), '{}') into v_ids from unnest(coalesce(p_source_ids, '{}')) as x;
  if cardinality(v_ids) not between 1 and 20 then
    raise exception 'A study guide must cite between 1 and 20 notes.' using errcode = '22023';
  end if;
  if not exists (select 1 from public.streams where id = p_stream_id and school_id = v_school)
     or not exists (select 1 from public.subjects where id = p_subject_id and school_id = v_school) then
    raise exception 'Class or subject not found.' using errcode = 'P0002';
  end if;

  select count(*), jsonb_agg(jsonb_build_object('id', r.id, 'title', r.title, 'updated_at', r.updated_at) order by r.title)
    into v_found, v_snapshot
    from public.learning_resources r
   where r.id = any (v_ids) and r.school_id = v_school and r.stream_id = p_stream_id and r.subject_id = p_subject_id
     and r.kind = 'note' and r.published;
  if v_found <> cardinality(v_ids) then
    raise exception 'Every source must be a published note for this class and subject.' using errcode = '22023';
  end if;

  select id into v_actor from public.school_users
   where auth_user_id = auth.uid() and school_id = v_school and status = 'active' limit 1;

  insert into public.tutor_drafts (school_id, stream_id, subject_id, title, body, source_resource_ids, source_snapshot, model, prompt_version, created_by)
  values (v_school, p_stream_id, p_subject_id, btrim(p_title), btrim(p_body), v_ids, v_snapshot, p_model, p_prompt_version, v_actor)
  returning id into v_id;
  return v_id;
end;
$$;
revoke all on function public.save_tutor_draft(uuid, uuid, text, text, uuid[], text, text) from public, anon;
grant execute on function public.save_tutor_draft(uuid, uuid, text, text, uuid[], text, text) to authenticated;

-- Edit a draft's title/body (only while it is still a draft; the sources cannot be changed).
create or replace function public.update_tutor_draft(p_id uuid, p_title text, p_body text)
returns void
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_school uuid := public.tutor_guard();
  v_actor uuid;
  d record;
begin
  if p_title is null or char_length(btrim(p_title)) not between 1 and 150
     or p_body is null or char_length(btrim(p_body)) not between 1 and 12000 then
    raise exception 'Invalid tutor draft.' using errcode = '22023';
  end if;
  select id into v_actor from public.school_users
   where auth_user_id = auth.uid() and school_id = v_school and status = 'active' limit 1;
  select created_by, status into d from public.tutor_drafts where id = p_id and school_id = v_school;
  if not found then
    raise exception 'Draft not found.' using errcode = 'P0002';
  end if;
  if d.created_by is distinct from v_actor and not auth_has_permission('academics.write') then
    raise exception 'You can only change your own drafts.' using errcode = '42501';
  end if;
  if d.status <> 'draft' then
    raise exception 'Only a draft can be edited.' using errcode = '22023';
  end if;
  update public.tutor_drafts set title = btrim(p_title), body = btrim(p_body), updated_at = now()
   where id = p_id and school_id = v_school;
end;
$$;
revoke all on function public.update_tutor_draft(uuid, text, text) from public, anon;
grant execute on function public.update_tutor_draft(uuid, text, text) to authenticated;

-- Teacher review. approve/reject: draft -> approved/rejected. withdraw: approved -> rejected.
-- Approving re-checks that every source note is still published and unchanged since the draft was written.
create or replace function public.review_tutor_draft(p_id uuid, p_action text)
returns void
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_school uuid := public.tutor_guard();
  v_actor uuid;
  d record;
  v_ok integer;
begin
  if p_action not in ('approve', 'reject', 'withdraw') then
    raise exception 'Invalid action.' using errcode = '22023';
  end if;
  select id into v_actor from public.school_users
   where auth_user_id = auth.uid() and school_id = v_school and status = 'active' limit 1;
  select created_by, status, source_resource_ids, created_at into d
    from public.tutor_drafts where id = p_id and school_id = v_school for update;
  if not found then
    raise exception 'Draft not found.' using errcode = 'P0002';
  end if;
  if d.created_by is distinct from v_actor and not auth_has_permission('academics.write') then
    raise exception 'You can only review your own drafts.' using errcode = '42501';
  end if;

  if p_action = 'withdraw' then
    if d.status <> 'approved' then
      raise exception 'Only an approved guide can be withdrawn.' using errcode = '22023';
    end if;
  elsif d.status <> 'draft' then
    raise exception 'This draft has already been reviewed.' using errcode = '22023';
  end if;

  if p_action = 'approve' then
    select count(*) into v_ok from public.learning_resources r
     where r.id = any (d.source_resource_ids) and r.school_id = v_school
       and r.kind = 'note' and r.published and r.updated_at <= d.created_at;
    if v_ok <> cardinality(d.source_resource_ids) then
      raise exception 'A source note was unpublished, deleted or changed after this draft was written. Generate it again.' using errcode = '22023';
    end if;
  end if;

  update public.tutor_drafts
     set status = case when p_action = 'approve' then 'approved' else 'rejected' end,
         reviewed_by = v_actor, reviewed_at = now(), updated_at = now()
   where id = p_id and school_id = v_school;
end;
$$;
revoke all on function public.review_tutor_draft(uuid, text) from public, anon;
grant execute on function public.review_tutor_draft(uuid, text) to authenticated;
