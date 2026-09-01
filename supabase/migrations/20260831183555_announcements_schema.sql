-- ============================================================================
-- Announcements -- Phase 0: schema
--
-- GTM tracker: PA-01 (whole school), PA-02 (grade), PA-03 (class/stream),
-- PA-04 (single student's guardians), PA-06 (urgency), PA-09 (multi-guardian
-- -- already true by construction via student_guardians), PA-11 (withdraw),
-- PA-12 (authorised-staff-only publishing), PA-13 (audit: actor + timestamp
-- on every state change), PA-14 partial (delivered/read/acknowledged).
--
-- Deliberately out of scope this migration (tracked as follow-up tasks):
-- PA-05 boarding-house targeting, PA-07 scheduled publish, PA-08 attachments,
-- PA-10 guardian-side search/filter UI.
--
-- Modelled on connect_items / connect_item_recipients (see
-- 20260828060343_educore_connect_phase0_schema.sql): no client write policy
-- on any table, every write goes through a SECURITY DEFINER RPC in the
-- companion permissions/RLS/RPC migration.
--
-- Targeting: "classes" in this codebase is the grade level (e.g. "Grade 6");
-- PA-02's "grade" scope maps to target_class_id -> classes.id. "streams" is
-- the concrete teaching unit (e.g. "6A"); PA-03's "class" scope maps to
-- target_stream_id -> streams.id. Only one of target_class_id /
-- target_stream_id / target_student_id is set, matching `scope`.
-- ============================================================================

create table announcements (
  id uuid primary key default gen_random_uuid(),
  school_id uuid not null references schools(id) on delete cascade,
  created_by uuid not null references school_users(id),
  title text not null,
  body text not null,
  urgency text not null default 'normal' check (urgency in ('normal', 'action_required', 'urgent')),
  scope text not null check (scope in ('whole_school', 'grade', 'class', 'student')),
  target_class_id uuid references classes(id),
  target_stream_id uuid references streams(id),
  target_student_id uuid references students(id),
  status text not null default 'draft' check (status in ('draft', 'published', 'withdrawn')),
  published_by uuid references school_users(id),
  published_at timestamptz,
  withdrawn_by uuid references school_users(id),
  withdrawn_at timestamptz,
  withdrawal_reason text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check ((status = 'published') = (published_at is not null)),
  check ((status = 'withdrawn') = (withdrawn_at is not null)),
  check (
    (scope = 'whole_school' and target_class_id is null and target_stream_id is null and target_student_id is null)
    or (scope = 'grade' and target_class_id is not null and target_stream_id is null and target_student_id is null)
    or (scope = 'class' and target_class_id is null and target_stream_id is not null and target_student_id is null)
    or (scope = 'student' and target_class_id is null and target_stream_id is null and target_student_id is not null)
  )
);

create index idx_announcements_school_id on announcements(school_id);
create index idx_announcements_created_by on announcements(created_by);
create index idx_announcements_status on announcements(school_id, status);
create index idx_announcements_target_stream_id on announcements(target_stream_id) where target_stream_id is not null;
create index idx_announcements_target_student_id on announcements(target_student_id) where target_student_id is not null;

comment on column announcements.withdrawal_reason is
  'PA-11: shown to recipients who already saw the announcement, so a correction is traceable, not silently disappeared.';

create trigger trg_announcements_updated_at
  before update on announcements
  for each row execute function set_updated_at();

create trigger trg_audit_announcements
  after insert or update or delete on announcements
  for each row execute function public.audit_row_change();

-- ----------------------------------------------------------------------------
-- announcement_recipients: snapshot taken at publish time (not at creation --
-- a draft has no recipients yet). One row per guardian, carries read/ack
-- receipts for PA-14.
-- ----------------------------------------------------------------------------

create table announcement_recipients (
  id uuid primary key default gen_random_uuid(),
  announcement_id uuid not null references announcements(id) on delete cascade,
  guardian_user_id uuid not null references school_users(id),
  read_at timestamptz,
  acknowledged_at timestamptz,
  created_at timestamptz not null default now(),
  unique (announcement_id, guardian_user_id)
);

create index idx_announcement_recipients_announcement_id on announcement_recipients(announcement_id);
create index idx_announcement_recipients_guardian_user_id on announcement_recipients(guardian_user_id);

alter table announcements enable row level security;
alter table announcement_recipients enable row level security;
