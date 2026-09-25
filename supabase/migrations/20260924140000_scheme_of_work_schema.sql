-- Scheme of Work module: schema + permissions + RLS.
--
-- Additive only -- no existing table is altered. Mirrors the academics
-- module's own pattern (phase1_item2_academics_schema.sql /
-- phase1_item2_academics_permissions_and_rls.sql): school_id column on
-- every table, auth_school_id()/auth_is_super_admin()/auth_has_permission()
-- in every policy, set_updated_at() trigger, permission keys granted per
-- role via role_permissions.
--
-- Three tables:
--   schemes_of_work            one row per teacher+class(+stream)+subject
--                               +term scheme (the "cover sheet")
--   scheme_of_work_entries     the week-by-week lesson rows under a scheme
--   scheme_of_work_ai_requests audit/idempotency log for AI generation
--                               requests (populated by the AI action, a
--                               separate follow-up PR) -- created now so the
--                               request_id/idempotency-key contract is fixed
--                               from day one instead of retrofitted later.
--
-- Curriculum-authority note (spec item 3 / item 7): no "verified curriculum"
-- table exists yet anywhere in EduCore (grep found none), so there is no
-- source of truth to join against. scheme_of_work_entries.source below
-- records whether a row came from a teacher or from AI, and the AI action
-- is responsible for labelling AI output as a draft requiring verification
-- -- this migration only lays down the column that makes that possible.

-- ---------------------------------------------------------------------------
-- schemes_of_work
-- ---------------------------------------------------------------------------
create table schemes_of_work (
  id uuid primary key default gen_random_uuid(),
  school_id uuid not null references schools(id),
  academic_year_id uuid not null references academic_years(id),
  term_id uuid not null references terms(id),
  class_id uuid not null references classes(id),
  stream_id uuid references streams(id),
  subject_id uuid not null references subjects(id),
  teacher_id uuid not null references school_users(id),

  status text not null default 'draft'
    check (status in ('draft', 'in_progress', 'submitted', 'under_review', 'reviewed', 'approved')),

  total_weeks smallint not null check (total_weeks > 0 and total_weeks <= 52),
  lessons_per_week smallint not null check (lessons_per_week > 0 and lessons_per_week <= 20),

  -- 'manual' | 'ai_generated' -- set once at creation from how the scheme
  -- was started; individual entries carry their own source too (see below),
  -- since a manually-created scheme can still contain AI-assisted entries.
  origin text not null default 'manual' check (origin in ('manual', 'ai_generated')),

  submitted_at timestamptz,
  submitted_by uuid references school_users(id),
  reviewed_by uuid references school_users(id),
  reviewed_at timestamptz,
  review_comment text,

  created_by uuid references school_users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  -- One in-flight scheme per teacher+class+stream+subject+term. Deliberately
  -- NOT globally unique on (stream_id, subject_id, term_id) -- spec item 25
  -- lists teacher_id on the row precisely so a subject can be co-taught
  -- without teachers colliding on the same scheme.
  unique (school_id, term_id, class_id, stream_id, subject_id, teacher_id)
);

create index idx_schemes_of_work_school on schemes_of_work (school_id);
create index idx_schemes_of_work_teacher on schemes_of_work (teacher_id);
create index idx_schemes_of_work_term on schemes_of_work (term_id);
create index idx_schemes_of_work_status on schemes_of_work (status);

create trigger trg_schemes_of_work_updated_at
  before update on schemes_of_work
  for each row execute function set_updated_at();

-- ---------------------------------------------------------------------------
-- scheme_of_work_entries
-- ---------------------------------------------------------------------------
create table scheme_of_work_entries (
  id uuid primary key default gen_random_uuid(),
  scheme_id uuid not null references schemes_of_work(id) on delete cascade,

  week_number smallint not null check (week_number > 0 and week_number <= 52),
  lesson_number smallint not null check (lesson_number > 0 and lesson_number <= 20),
  entry_date date,

  topic text,
  subtopic text,
  learning_outcomes text,
  content text,
  activities text,
  teaching_methods text,
  resources text,
  assessment_methods text,
  "references" text,
  remarks text,

  completion_status text not null default 'pending' check (completion_status in ('pending', 'completed')),
  completed_at timestamptz,

  -- 'manual' | 'ai_generated' | 'ai_assisted' (teacher accepted an AI Assist
  -- suggestion into an otherwise manual entry). Per-entry, not per-scheme,
  -- because spec item 12/13 lets a teacher regenerate or AI-assist one
  -- entry at a time inside an otherwise manual or already-approved scheme.
  source text not null default 'manual' check (source in ('manual', 'ai_generated', 'ai_assisted')),

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  unique (scheme_id, week_number, lesson_number)
);

create index idx_scheme_of_work_entries_scheme on scheme_of_work_entries (scheme_id);

create trigger trg_scheme_of_work_entries_updated_at
  before update on scheme_of_work_entries
  for each row execute function set_updated_at();

-- ---------------------------------------------------------------------------
-- scheme_of_work_ai_requests
-- Audit + idempotency log for AI generation calls. One row per attempt,
-- written before the outbound AI call and updated after -- this is what
-- lets a retried/duplicated client request be recognised and deduped
-- (spec items 13/14), and gives the failure-category/duration logging that
-- items 21-22 ask for without putting any of that in application logs.
-- ---------------------------------------------------------------------------
create table scheme_of_work_ai_requests (
  id uuid primary key default gen_random_uuid(),
  school_id uuid not null references schools(id),
  scheme_id uuid references schemes_of_work(id) on delete set null,
  requested_by uuid not null references school_users(id),

  -- Client-supplied idempotency key (e.g. a UUID generated once per "click"
  -- of Generate/Regenerate and reused across retries of that same click).
  idempotency_key uuid not null,

  prompt_version text not null,
  weeks_requested smallint not null,
  weeks_generated smallint,

  status text not null default 'pending'
    check (status in ('pending', 'succeeded', 'partial', 'failed')),
  failure_category text
    check (failure_category is null or failure_category in (
      'invalid_input', 'no_permission', 'network', 'timeout', 'rate_limit',
      'ai_unavailable', 'auth_config', 'malformed_response', 'empty_response',
      'validation_failed', 'server_error'
    )),

  duration_ms integer,
  created_at timestamptz not null default now(),
  completed_at timestamptz,

  unique (requested_by, idempotency_key)
);

create index idx_scheme_of_work_ai_requests_school on scheme_of_work_ai_requests (school_id);
create index idx_scheme_of_work_ai_requests_scheme on scheme_of_work_ai_requests (scheme_id);

-- ---------------------------------------------------------------------------
-- Permissions
-- Mirrors the academics.read/academics.write split, plus a narrower
-- generate_ai key gated the same defensive way draftCommentWithAI() gates
-- report_cards.approve -- so a plain teacher can draft/save schemes for
-- their own classes but AI usage can be independently rate-limited/audited,
-- and review/approval is restricted to school leadership (no HOD role
-- exists in EduCore's role catalog today, so write_any goes to the same
-- three leadership roles competency_ratings.write_any and academics.write
-- already use).
-- ---------------------------------------------------------------------------
insert into role_permissions (role_id, permission_key, allowed)
select id, 'scheme_of_work.read', true
from roles where name in ('school_owner','principal','deputy_principal','teacher','class_teacher');

insert into role_permissions (role_id, permission_key, allowed)
select id, 'scheme_of_work.write', true
from roles where name in ('teacher','class_teacher');

insert into role_permissions (role_id, permission_key, allowed)
select id, 'scheme_of_work.write_any', true
from roles where name in ('school_owner','principal','deputy_principal');

insert into role_permissions (role_id, permission_key, allowed)
select id, 'scheme_of_work.generate_ai', true
from roles where name in ('teacher','class_teacher','school_owner','principal','deputy_principal');

insert into role_permissions (role_id, permission_key, allowed)
select id, 'scheme_of_work.review', true
from roles where name in ('school_owner','principal','deputy_principal');

-- ---------------------------------------------------------------------------
-- Missing helper: every existing "own record" RLS policy in this codebase
-- repeats the subquery `(select id from school_users where auth_user_id =
-- auth.uid() and status = 'active')` inline (applications, health, etc.)
-- rather than a named function. schemes_of_work needs the same lookup
-- twice per policy below, so it's pulled into a helper here -- same shape,
-- naming and security posture as the existing auth_school_id()/
-- auth_is_super_admin() helpers in phase0_step2_auth_helpers_and_rls.sql,
-- just not previously factored out. Net-new function, nothing else changed.
-- ---------------------------------------------------------------------------
create or replace function auth_school_user_id()
returns uuid
language sql
stable
security definer
set search_path = public
as $$
  select id
  from school_users
  where auth_user_id = auth.uid()
    and status = 'active'
  limit 1;
$$;

-- ---------------------------------------------------------------------------
-- RLS
-- ---------------------------------------------------------------------------
alter table schemes_of_work enable row level security;
alter table scheme_of_work_entries enable row level security;
alter table scheme_of_work_ai_requests enable row level security;

-- schemes_of_work: any school user with read can see every scheme in their
-- school (dashboard/filter needs cross-teacher visibility, spec item 1/23);
-- write is scoped to the owning teacher unless the user holds write_any.
create policy schemes_of_work_select on schemes_of_work for select
  using (auth_is_super_admin() or (school_id = auth_school_id() and auth_has_permission('scheme_of_work.read')));

create policy schemes_of_work_write on schemes_of_work for all
  using (
    auth_is_super_admin()
    or (
      school_id = auth_school_id()
      and (
        auth_has_permission('scheme_of_work.write_any')
        or (auth_has_permission('scheme_of_work.write') and teacher_id = auth_school_user_id())
      )
    )
  )
  with check (
    auth_is_super_admin()
    or (
      school_id = auth_school_id()
      and (
        auth_has_permission('scheme_of_work.write_any')
        or (auth_has_permission('scheme_of_work.write') and teacher_id = auth_school_user_id())
      )
    )
  );

-- scheme_of_work_entries: no school_id of its own, scoped through the
-- parent scheme -- same shape as report_cards -> exams elsewhere.
create policy scheme_of_work_entries_select on scheme_of_work_entries for select
  using (
    auth_is_super_admin()
    or exists (
      select 1 from schemes_of_work s
      where s.id = scheme_of_work_entries.scheme_id
        and s.school_id = auth_school_id()
        and auth_has_permission('scheme_of_work.read')
    )
  );

create policy scheme_of_work_entries_write on scheme_of_work_entries for all
  using (
    auth_is_super_admin()
    or exists (
      select 1 from schemes_of_work s
      where s.id = scheme_of_work_entries.scheme_id
        and s.school_id = auth_school_id()
        and (
          auth_has_permission('scheme_of_work.write_any')
          or (auth_has_permission('scheme_of_work.write') and s.teacher_id = auth_school_user_id())
        )
    )
  )
  with check (
    auth_is_super_admin()
    or exists (
      select 1 from schemes_of_work s
      where s.id = scheme_of_work_entries.scheme_id
        and s.school_id = auth_school_id()
        and (
          auth_has_permission('scheme_of_work.write_any')
          or (auth_has_permission('scheme_of_work.write') and s.teacher_id = auth_school_user_id())
        )
    )
  );

-- scheme_of_work_ai_requests: a user can only see/insert their own request
-- rows -- this table is an operational log, not a shared record, and
-- nothing in the spec calls for cross-teacher visibility of it.
create policy scheme_of_work_ai_requests_select on scheme_of_work_ai_requests for select
  using (auth_is_super_admin() or (school_id = auth_school_id() and requested_by = auth_school_user_id()));

create policy scheme_of_work_ai_requests_write on scheme_of_work_ai_requests for all
  using (auth_is_super_admin() or (school_id = auth_school_id() and requested_by = auth_school_user_id()))
  with check (auth_is_super_admin() or (school_id = auth_school_id() and requested_by = auth_school_user_id()));

-- ---------------------------------------------------------------------------
-- Optional catalog registration (platform_modules / school_modules,
-- added 2026-09-24). Additive metadata row only -- no gating logic is wired
-- to it anywhere yet, matching how every other non-core module in that
-- catalog shipped (schema+catalog first, gating wired later as its own PR).
-- Safe to skip if this repo's platform_modules table doesn't exist yet in
-- the environment this runs against; guarded so it never blocks the rest
-- of this migration.
-- ---------------------------------------------------------------------------
do $$
begin
  if to_regclass('public.platform_modules') is not null then
    insert into public.platform_modules (key, label, description, is_core)
    values ('scheme_of_work', 'Scheme of Work', 'AI-assisted scheme of work drafting, review and tracking.', false)
    on conflict (lower(key)) do nothing;
  end if;
end $$;
