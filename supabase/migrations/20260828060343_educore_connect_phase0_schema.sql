-- ============================================================================
-- Educore Connect -- Phase 0: schema
--
-- Structured, student-centric parent-teacher communication. Core workflow:
-- class teacher creates an item for a specific student -> guardians of that
-- student see it -> guardian reads/acknowledges/replies -> teacher sees the
-- response -> teacher resolves. Not a WhatsApp-style open chat: guardian
-- actions are constrained to a fixed set of event types on an existing item,
-- no guardian-initiated items, no free-form threads.
--
-- Three tables:
--   connect_items            -- the item itself (one per student per topic)
--   connect_item_recipients  -- one row per guardian of the student, snapshot
--                                at creation time, carries the read receipt
--   connect_item_events      -- append-only timeline (acknowledged / replied /
--                                status_changed / reassigned); "created" is
--                                implicit from connect_items.created_at, not
--                                duplicated here. "read" is not an event either
--                                -- it lives solely on connect_item_recipients
--                                .read_at, per the plan's own derivation rule.
--
-- Phase 1 categories are a hard 3-value CHECK (request/academic/attendance),
-- not left open at the DB level -- narrower default, extend via migration
-- later if the taxonomy grows. `reassigned` is included in the event_type
-- CHECK for forward-compatibility (subject-teacher authorship is explicitly
-- out of scope this phase) even though nothing emits it yet; RLS is what
-- actually blocks a guardian from ever writing it, not the CHECK constraint.
--
-- archived_at/purge_at added now (nullable, additive) matching the existing
-- notification_logs/whatsapp_conversations retention convention -- no active
-- purge cron wired this phase, columns are future-proofing only per the plan.
-- ============================================================================

create table connect_items (
  id uuid primary key default gen_random_uuid(),
  school_id uuid not null references schools(id) on delete cascade,
  student_id uuid not null references students(id) on delete cascade,
  created_by uuid not null references school_users(id),
  category text not null check (category in ('request', 'academic', 'attendance')),
  title text not null,
  body text not null,
  due_date date,
  requires_response boolean not null default false,
  status text not null default 'open' check (status in ('open', 'resolved')),
  resolved_by uuid references school_users(id),
  resolved_at timestamptz,
  archived_at timestamptz,
  purge_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check ((status = 'resolved') = (resolved_at is not null))
);

create index idx_connect_items_school_id on connect_items(school_id);
create index idx_connect_items_student_id on connect_items(student_id);
create index idx_connect_items_created_by on connect_items(created_by);
create index idx_connect_items_status on connect_items(school_id, status);
create index connect_items_purge_idx on connect_items(purge_at) where purge_at is not null;

comment on column connect_items.archived_at is
  'Reserved for a future archive sweep, matching notification_logs/whatsapp_conversations. Not set by any function yet -- Phase 0/1 ships the column only.';
comment on column connect_items.purge_at is
  'Reserved for a future purge sweep. Not set by any function yet -- Phase 0/1 ships the column only.';

create trigger trg_connect_items_updated_at
  before update on connect_items
  for each row execute function set_updated_at();

create trigger trg_audit_connect_items
  after insert or update or delete on connect_items
  for each row execute function public.audit_row_change();

-- ----------------------------------------------------------------------------

create table connect_item_recipients (
  id uuid primary key default gen_random_uuid(),
  item_id uuid not null references connect_items(id) on delete cascade,
  guardian_user_id uuid not null references school_users(id),
  read_at timestamptz,
  created_at timestamptz not null default now(),
  unique (item_id, guardian_user_id)
);

create index idx_connect_item_recipients_item_id on connect_item_recipients(item_id);
create index idx_connect_item_recipients_guardian_user_id on connect_item_recipients(guardian_user_id);

-- ----------------------------------------------------------------------------

create table connect_item_events (
  id uuid primary key default gen_random_uuid(),
  item_id uuid not null references connect_items(id) on delete cascade,
  event_type text not null check (event_type in ('acknowledged', 'replied', 'status_changed', 'reassigned')),
  actor_role text not null check (actor_role in ('teacher', 'guardian', 'system')),
  actor_school_user_id uuid references school_users(id),
  body text,
  old_status text,
  new_status text,
  created_at timestamptz not null default now()
);

create index idx_connect_item_events_item_id on connect_item_events(item_id, created_at);

alter table connect_items enable row level security;
alter table connect_item_recipients enable row level security;
alter table connect_item_events enable row level security;
