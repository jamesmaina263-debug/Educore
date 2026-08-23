-- WhatsApp two-way chatbox infrastructure (bot-first, escalates to a staff inbox).
--
-- Deliberately separate from notification_logs/communication_templates: those model a one-way
-- broadcast (compose -> send -> log), no threading, no inbound direction, no read/assignment state.
-- A conversation needs a thread identity (one per phone number per school), a status lifecycle
-- (bot handling -> escalated/staff handling -> closed), and per-message direction/sender. Forcing
-- that onto notification_logs would mean bolting nullable thread columns onto a table whose whole
-- design is "one row per outbound attempt" -- a new pair of tables is the honest shape.
--
-- Known limitation, not silently hidden: TWILIO_WHATSAPP_FROM (see supabase/functions/_shared/
-- whatsapp/) is one number for the whole deployment, not one per school. Inbound messages are
-- matched to a school by looking up which school's guardians the sender's phone belongs to
-- (see whatsapp-webhook). A phone number that isn't on file as a guardian anywhere, or that's a
-- guardian in more than one school, can't be routed automatically -- the webhook sends a
-- clarifying reply rather than guessing. The durable fix is a Twilio number per school (or per
-- WhatsApp Business Account with a shared number + school-selection first message); that's a
-- provisioning/product decision outside this migration's scope.

create table school_whatsapp_settings (
  school_id uuid primary key references schools(id) on delete cascade,
  bot_enabled boolean not null default true, -- staff kill-switch: off routes every inbound straight to the human inbox
  greeting_message text not null default 'Hi! This is the school''s automated WhatsApp assistant. You can ask about fee balance or attendance, or type ''agent'' to talk to the office.',
  updated_at timestamptz not null default now()
);
comment on table school_whatsapp_settings is 'Per-school toggle/config for the WhatsApp bot. One row per school, created on first inbound message if missing (see whatsapp-webhook), not eagerly for every school.';

create trigger trg_school_whatsapp_settings_updated_at
  before update on school_whatsapp_settings
  for each row execute function set_updated_at();

alter table school_whatsapp_settings enable row level security;

create policy school_whatsapp_settings_select on school_whatsapp_settings for select
  using (school_id = auth_school_id() and auth_has_permission('communication.read'));
create policy school_whatsapp_settings_update on school_whatsapp_settings for update
  using (school_id = auth_school_id() and auth_has_permission('communication.write'))
  with check (school_id = auth_school_id() and auth_has_permission('communication.write'));
-- No client insert policy: the webhook creates the default row via the service role the first
-- time a school receives an inbound message, same pattern as notification_logs below.

create table whatsapp_conversations (
  id uuid primary key default gen_random_uuid(),
  school_id uuid not null references schools(id) on delete cascade,
  phone_number text not null, -- E.164, e.g. +2547XXXXXXXX (the "whatsapp:" prefix is stripped before storage)
  guardian_user_id uuid references school_users(id) on delete set null, -- null if the sender didn't resolve to a known guardian
  student_id uuid references students(id) on delete set null, -- which child the thread is currently "about"; a guardian with several
    -- children can switch context mid-conversation (see botIntents.ts) -- this is a cursor, not a permanent link
  status text not null default 'bot' check (status in ('bot', 'escalated', 'staff_handling', 'closed')),
  assigned_to uuid references school_users(id) on delete set null, -- staff member currently handling it, if any
  unread_count integer not null default 0, -- inbound messages since a staff member last opened the thread
  last_message_at timestamptz not null default now(),
  last_message_preview text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (school_id, phone_number)
);
comment on table whatsapp_conversations is 'One thread per (school, phone number). status: bot = the bot answers automatically; escalated = bot handed off, waiting for a human to pick it up; staff_handling = a staff member is actively replying; closed = resolved, reopens to bot on the next inbound message.';

create trigger trg_whatsapp_conversations_updated_at
  before update on whatsapp_conversations
  for each row execute function set_updated_at();

create table whatsapp_messages (
  id uuid primary key default gen_random_uuid(),
  conversation_id uuid not null references whatsapp_conversations(id) on delete cascade,
  school_id uuid not null references schools(id) on delete cascade, -- denormalized from the conversation so RLS/indexes don't need a join
  direction text not null check (direction in ('inbound', 'outbound')),
  sender_type text not null check (sender_type in ('guardian', 'bot', 'staff')),
  sender_staff_id uuid references school_users(id) on delete set null, -- set only when sender_type = 'staff'
  body text not null,
  twilio_message_sid text,
  status text not null default 'received' check (status in ('received', 'sent', 'delivered', 'failed')),
  provider_response text,
  created_at timestamptz not null default now()
);
comment on table whatsapp_messages is 'Every inbound/outbound message in a WhatsApp thread, in order. Direction + sender_type together answer "who said this and which way did it go" (e.g. outbound/bot = the automated reply, outbound/staff = a human typed it, inbound/guardian = the parent).';

alter table whatsapp_conversations enable row level security;
alter table whatsapp_messages enable row level security;

create index whatsapp_conversations_school_status_idx on whatsapp_conversations (school_id, status, last_message_at desc);
create index whatsapp_conversations_guardian_idx on whatsapp_conversations (guardian_user_id);
create index whatsapp_conversations_student_idx on whatsapp_conversations (student_id);
create index whatsapp_conversations_assigned_to_idx on whatsapp_conversations (assigned_to);
create index whatsapp_messages_conversation_idx on whatsapp_messages (conversation_id, created_at);
create index whatsapp_messages_school_idx on whatsapp_messages (school_id);

-- Staff with communication.read can see every thread for their school -- a WhatsApp inbox is a
-- shared team resource (like a support inbox), not scoped to whoever happens to be assigned, so an
-- unassigned/escalated thread is visible to everyone who could pick it up.
create policy whatsapp_conversations_select on whatsapp_conversations for select
  using (school_id = auth_school_id() and auth_has_permission('communication.read'));

-- Staff can claim/reassign/close/reopen a thread and clear unread_count directly from the client --
-- these are just status-tracking fields, unlike phone_number/guardian_user_id/student_id which are
-- resolved identity facts the client has no business rewriting. Not column-restricted at the RLS
-- layer (Postgres RLS can't do column-level checks); enforced instead by only ever sending those
-- specific fields from the UI actions. A malicious/buggy client could still rewrite phone_number
-- via a raw update -- flagged as a real gap, not something this migration closes with a trigger.
create policy whatsapp_conversations_update on whatsapp_conversations for update
  using (school_id = auth_school_id() and auth_has_permission('communication.write'))
  with check (school_id = auth_school_id() and auth_has_permission('communication.write'));
-- No client insert/delete: conversations are only ever created by the webhook (service role) on
-- first contact from a phone number.

create policy whatsapp_messages_select on whatsapp_messages for select
  using (school_id = auth_school_id() and auth_has_permission('communication.read'));
-- No client insert policy on whatsapp_messages at all -- every row (inbound, bot reply, or staff
-- reply) is written by a service-role Edge Function (whatsapp-webhook or whatsapp-send-reply)
-- because every row that leaves the building has to go through the Twilio API call first, which
-- Postgres can't do on its own. Same reasoning as notification_logs above.
