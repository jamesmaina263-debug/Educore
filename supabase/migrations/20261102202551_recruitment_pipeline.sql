-- Phase 7.1 (1/2): recruitment pipeline. Additive only; ships dark.
--
-- * New flag feature.hr.recruitment (catalog entry, enabled for nobody).
-- * New tables: recruitment_openings (a vacancy), recruitment_candidates (one person for one opening, at a
--   stage) and recruitment_events (append-only history of stage moves and notes).
-- * Candidate data is personal data: reads and writes both need staff.manage (school owner, principal,
--   deputy principal) in the caller's own school, plus the flag. RLS gives select only; there are NO direct
--   write policies, every change goes through the SECURITY DEFINER functions below.
-- * Nothing existing is touched, and nothing here sends a message, creates a login or edits payroll:
--   marking a candidate "hired" is a record only; onboarding the person stays the existing manual step.
-- * recruitment_events is never edited or deleted (no function updates or deletes it).
-- Rollback: switch the flag off (reads return nothing, functions refuse). Nothing else depends on these objects.

-- 1. Flag catalog entry.
insert into public.platform_feature_flags (key, label, description)
select 'feature.hr.recruitment',
       'Recruitment pipeline',
       'Job openings, candidates and hiring stages for staff recruitment. Records only; sends nothing. Off by default.'
where not exists (
  select 1 from public.platform_feature_flags where lower(key) = 'feature.hr.recruitment'
);

-- 2. Openings.
create table if not exists public.recruitment_openings (
  id uuid primary key default gen_random_uuid(),
  school_id uuid not null references public.schools(id) on delete cascade,
  title text not null check (char_length(btrim(title)) between 1 and 150),
  department text check (department is null or char_length(department) <= 100),
  employment_type text not null default 'full_time'
    check (employment_type in ('full_time', 'part_time', 'contract', 'temporary')),
  description text check (description is null or char_length(description) <= 4000),
  positions integer not null default 1 check (positions between 1 and 100),
  closes_on date,
  status text not null default 'draft' check (status in ('draft', 'open', 'closed', 'filled', 'cancelled')),
  created_by uuid references public.school_users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
comment on table public.recruitment_openings is
  'A vacancy. Never deleted: status moves to closed/filled/cancelled. Written only by save_recruitment_opening().';
create index if not exists recruitment_openings_school_status on public.recruitment_openings (school_id, status);
alter table public.recruitment_openings enable row level security;
drop policy if exists recruitment_openings_select on public.recruitment_openings;
create policy recruitment_openings_select on public.recruitment_openings for select
  using (
    auth_is_super_admin()
    or (
      school_id = auth_school_id()
      and auth_has_permission('staff.manage')
      and public.my_school_has_feature_flag('feature.hr.recruitment')
    )
  );

-- 3. Candidates.
create table if not exists public.recruitment_candidates (
  id uuid primary key default gen_random_uuid(),
  school_id uuid not null references public.schools(id) on delete cascade,
  opening_id uuid not null references public.recruitment_openings(id) on delete cascade,
  full_name text not null check (char_length(btrim(full_name)) between 1 and 120),
  email text check (email is null or (char_length(email) <= 200 and email like '%_@_%')),
  phone text check (phone is null or char_length(phone) <= 30),
  source text check (source is null or char_length(source) <= 100),
  stage text not null default 'applied'
    check (stage in ('applied', 'shortlisted', 'interview', 'offer', 'hired', 'rejected', 'withdrawn')),
  stage_changed_at timestamptz not null default now(),
  created_by uuid references public.school_users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
comment on table public.recruitment_candidates is
  'One person for one opening. Never deleted: rejected/withdrawn are stages. Written only by add_recruitment_candidate() / move_recruitment_candidate().';
create index if not exists recruitment_candidates_opening on public.recruitment_candidates (opening_id, stage);
create index if not exists recruitment_candidates_school on public.recruitment_candidates (school_id);
-- The same email cannot be added twice to the same opening.
create unique index if not exists recruitment_candidates_opening_email_uniq
  on public.recruitment_candidates (opening_id, lower(btrim(email))) where email is not null;
alter table public.recruitment_candidates enable row level security;
drop policy if exists recruitment_candidates_select on public.recruitment_candidates;
create policy recruitment_candidates_select on public.recruitment_candidates for select
  using (
    auth_is_super_admin()
    or (
      school_id = auth_school_id()
      and auth_has_permission('staff.manage')
      and public.my_school_has_feature_flag('feature.hr.recruitment')
    )
  );

-- 4. History: every stage move and note, append-only.
create table if not exists public.recruitment_events (
  id uuid primary key default gen_random_uuid(),
  school_id uuid not null references public.schools(id) on delete cascade,
  candidate_id uuid not null references public.recruitment_candidates(id) on delete cascade,
  kind text not null check (kind in ('stage', 'note')),
  from_stage text,
  to_stage text,
  body text check (body is null or char_length(body) <= 2000),
  created_by uuid references public.school_users(id) on delete set null,
  created_at timestamptz not null default now(),
  constraint recruitment_events_shape check (
    (kind = 'stage' and to_stage is not null) or (kind = 'note' and body is not null)
  )
);
comment on table public.recruitment_events is
  'Append-only recruitment history. Written only by the recruitment functions; nothing updates or deletes it.';
create index if not exists recruitment_events_candidate on public.recruitment_events (candidate_id, created_at);
alter table public.recruitment_events enable row level security;
drop policy if exists recruitment_events_select on public.recruitment_events;
create policy recruitment_events_select on public.recruitment_events for select
  using (
    auth_is_super_admin()
    or (
      school_id = auth_school_id()
      and auth_has_permission('staff.manage')
      and public.my_school_has_feature_flag('feature.hr.recruitment')
    )
  );

-- Who changed an opening and when: the existing generic audit trigger (no personal data on this table).
drop trigger if exists trg_audit_recruitment_openings on public.recruitment_openings;
create trigger trg_audit_recruitment_openings
  after insert or update or delete on public.recruitment_openings
  for each row execute function public.audit_row_change();

-- 5. Shared guard: caller must be staff.manage in their own school and the flag must be on.
create or replace function public.recruitment_guard()
returns uuid
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_school uuid := auth_school_id();
begin
  if v_school is null or not auth_has_permission('staff.manage') then
    raise exception 'Not authorized to manage recruitment.' using errcode = '42501';
  end if;
  if not public.school_has_feature_flag(v_school, 'feature.hr.recruitment') then
    raise exception 'Recruitment is not enabled for this school.' using errcode = '55000';
  end if;
  return v_school;
end;
$$;
revoke all on function public.recruitment_guard() from public, anon, authenticated;

-- 6. Save an opening (create when p_id is null).
create or replace function public.save_recruitment_opening(
  p_id uuid,
  p_title text,
  p_department text,
  p_employment_type text,
  p_description text,
  p_positions integer,
  p_closes_on date,
  p_status text
) returns uuid
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_school uuid := public.recruitment_guard();
  v_actor uuid;
  v_id uuid;
  v_old text;
begin
  if p_title is null or char_length(btrim(p_title)) not between 1 and 150
     or p_employment_type is null or p_employment_type not in ('full_time', 'part_time', 'contract', 'temporary')
     or p_positions is null or p_positions not between 1 and 100
     or p_status is null or p_status not in ('draft', 'open', 'closed', 'filled', 'cancelled')
     or (p_department is not null and char_length(p_department) > 100)
     or (p_description is not null and char_length(p_description) > 4000) then
    raise exception 'Invalid opening details.' using errcode = '22023';
  end if;

  select id into v_actor from public.school_users
   where auth_user_id = auth.uid() and school_id = v_school and status = 'active' limit 1;

  if p_id is null then
    insert into public.recruitment_openings
      (school_id, title, department, employment_type, description, positions, closes_on, status, created_by)
    values (v_school, btrim(p_title), nullif(btrim(p_department), ''), p_employment_type, nullif(btrim(p_description), ''),
            p_positions, p_closes_on, p_status, v_actor)
    returning id into v_id;
  else
    select status into v_old from public.recruitment_openings where id = p_id and school_id = v_school;
    if v_old is null then
      raise exception 'Opening not found.' using errcode = 'P0002';
    end if;
    -- A finished vacancy is not silently reopened by a stray edit: cancelled stays cancelled.
    if v_old = 'cancelled' and p_status <> 'cancelled' then
      raise exception 'A cancelled opening cannot be reopened. Create a new opening.' using errcode = '22023';
    end if;
    update public.recruitment_openings
       set title = btrim(p_title), department = nullif(btrim(p_department), ''), employment_type = p_employment_type,
           description = nullif(btrim(p_description), ''), positions = p_positions, closes_on = p_closes_on,
           status = p_status, updated_at = now()
     where id = p_id and school_id = v_school
    returning id into v_id;
  end if;
  return v_id;
end;
$$;
revoke all on function public.save_recruitment_opening(uuid, text, text, text, text, integer, date, text) from public, anon;
grant execute on function public.save_recruitment_opening(uuid, text, text, text, text, integer, date, text) to authenticated;

-- 7. Add a candidate to an open opening. Starts at "applied".
create or replace function public.add_recruitment_candidate(
  p_opening_id uuid,
  p_full_name text,
  p_email text,
  p_phone text,
  p_source text
) returns uuid
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_school uuid := public.recruitment_guard();
  v_actor uuid;
  v_id uuid;
  v_status text;
begin
  if p_full_name is null or char_length(btrim(p_full_name)) not between 1 and 120
     or (nullif(btrim(p_email), '') is not null and (char_length(btrim(p_email)) > 200 or btrim(p_email) not like '%_@_%'))
     or (p_phone is not null and char_length(p_phone) > 30)
     or (p_source is not null and char_length(p_source) > 100) then
    raise exception 'Invalid candidate details.' using errcode = '22023';
  end if;

  select status into v_status from public.recruitment_openings where id = p_opening_id and school_id = v_school;
  if v_status is null then
    raise exception 'Opening not found.' using errcode = 'P0002';
  end if;
  if v_status <> 'open' then
    raise exception 'Candidates can only be added to an open opening.' using errcode = '22023';
  end if;

  select id into v_actor from public.school_users
   where auth_user_id = auth.uid() and school_id = v_school and status = 'active' limit 1;

  begin
    insert into public.recruitment_candidates (school_id, opening_id, full_name, email, phone, source, created_by)
    values (v_school, p_opening_id, btrim(p_full_name), nullif(btrim(p_email), ''), nullif(btrim(p_phone), ''),
            nullif(btrim(p_source), ''), v_actor)
    returning id into v_id;
  exception when unique_violation then
    raise exception 'This email is already on this opening.' using errcode = '23505';
  end;

  insert into public.recruitment_events (school_id, candidate_id, kind, to_stage, created_by)
  values (v_school, v_id, 'stage', 'applied', v_actor);
  return v_id;
end;
$$;
revoke all on function public.add_recruitment_candidate(uuid, text, text, text, text) from public, anon;
grant execute on function public.add_recruitment_candidate(uuid, text, text, text, text) to authenticated;

-- 8. Move a candidate to the next stage. Forward one step at a time, or out (rejected / withdrawn) from any
--    live stage. hired, rejected and withdrawn are final. A rejection needs a reason.
create or replace function public.move_recruitment_candidate(
  p_candidate_id uuid,
  p_stage text,
  p_note text
) returns void
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_school uuid := public.recruitment_guard();
  v_actor uuid;
  v_from text;
  v_ok boolean;
begin
  if p_stage is null or p_stage not in ('shortlisted', 'interview', 'offer', 'hired', 'rejected', 'withdrawn')
     or (p_note is not null and char_length(p_note) > 2000) then
    raise exception 'Invalid stage.' using errcode = '22023';
  end if;

  select stage into v_from from public.recruitment_candidates
   where id = p_candidate_id and school_id = v_school for update;
  if v_from is null then
    raise exception 'Candidate not found.' using errcode = 'P0002';
  end if;

  v_ok := case v_from
    when 'applied' then p_stage in ('shortlisted', 'rejected', 'withdrawn')
    when 'shortlisted' then p_stage in ('interview', 'rejected', 'withdrawn')
    when 'interview' then p_stage in ('offer', 'rejected', 'withdrawn')
    when 'offer' then p_stage in ('hired', 'rejected', 'withdrawn')
    else false
  end;
  if not v_ok then
    raise exception 'A candidate cannot move from % to %.', v_from, p_stage using errcode = '22023';
  end if;
  if p_stage = 'rejected' and nullif(btrim(p_note), '') is null then
    raise exception 'Give a reason when rejecting a candidate.' using errcode = '22023';
  end if;

  select id into v_actor from public.school_users
   where auth_user_id = auth.uid() and school_id = v_school and status = 'active' limit 1;

  update public.recruitment_candidates
     set stage = p_stage, stage_changed_at = now(), updated_at = now()
   where id = p_candidate_id and school_id = v_school;

  insert into public.recruitment_events (school_id, candidate_id, kind, from_stage, to_stage, body, created_by)
  values (v_school, p_candidate_id, 'stage', v_from, p_stage, nullif(btrim(p_note), ''), v_actor);
end;
$$;
revoke all on function public.move_recruitment_candidate(uuid, text, text) from public, anon;
grant execute on function public.move_recruitment_candidate(uuid, text, text) to authenticated;

-- 9. Add a note to a candidate.
create or replace function public.add_recruitment_note(
  p_candidate_id uuid,
  p_body text
) returns uuid
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_school uuid := public.recruitment_guard();
  v_actor uuid;
  v_id uuid;
begin
  if p_body is null or char_length(btrim(p_body)) not between 1 and 2000 then
    raise exception 'A note must be between 1 and 2000 characters.' using errcode = '22023';
  end if;
  if not exists (select 1 from public.recruitment_candidates where id = p_candidate_id and school_id = v_school) then
    raise exception 'Candidate not found.' using errcode = 'P0002';
  end if;
  select id into v_actor from public.school_users
   where auth_user_id = auth.uid() and school_id = v_school and status = 'active' limit 1;
  insert into public.recruitment_events (school_id, candidate_id, kind, body, created_by)
  values (v_school, p_candidate_id, 'note', btrim(p_body), v_actor)
  returning id into v_id;
  return v_id;
end;
$$;
revoke all on function public.add_recruitment_note(uuid, text) from public, anon;
grant execute on function public.add_recruitment_note(uuid, text) to authenticated;
