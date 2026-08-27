-- Hardening pass on the WhatsApp chatbox before production: idempotency against Twilio retries,
-- explicit escalation reasons, first-class (but currently fallback-only) school/number routing,
-- and wiring the conversation table into the existing system-wide audit trigger. Deliberately
-- additive only -- no existing table's shape or behavior changes.

-- ----------------------------------------------------------------------------
-- 1. Inbound idempotency. Twilio retries a webhook delivery if it doesn't see a timely 2xx (see
-- whatsapp-webhook's EMPTY_TWIML-on-every-path comment) -- without this, a slow response or a
-- transient error after the reply was already sent would let the same inbound message get
-- processed twice: two bot replies, a doubled unread_count, or (once the M-Pesa integration
-- lands) a doubled action. Scoped to inbound only: outbound (bot/staff) messages aren't currently
-- stamped with the Twilio-assigned SID at all (the provider's send() returns void), so a blanket
-- unique constraint would reject every outbound insert -- capturing the outbound SID is a
-- separate, smaller piece of future work, not bundled in here.
create unique index whatsapp_messages_inbound_sid_unique
  on whatsapp_messages (twilio_message_sid)
  where direction = 'inbound' and twilio_message_sid is not null;

-- ----------------------------------------------------------------------------
-- 2. Escalation reasons. status = 'escalated' on its own doesn't say why -- a staff member
-- opening the inbox queue currently has to read the whole thread to find out. This also becomes
-- the first real signal for later product decisions (e.g. "which intents get escalated most
-- often" once more tools exist).
alter table whatsapp_conversations
  add column escalation_reason text check (
    escalation_reason is null or escalation_reason in (
      'explicit_request',      -- guardian asked for a human ("agent", "talk to someone", ...)
      'unrecognized_intent',   -- the bot couldn't classify what was being asked
      'authorization_denied',  -- the guardian asked about a student they aren't linked to
      'ambiguous_school',      -- the sending phone matches guardians at more than one school
      'tool_error'             -- a tool's data lookup failed
    )
  );

-- ----------------------------------------------------------------------------
-- 3. School/number routing as a first-class concept. Today there is exactly one Twilio WhatsApp
-- sender for the whole deployment (TWILIO_WHATSAPP_FROM), so this table is populated later, not
-- by this migration -- it exists now so the webhook can look up "which school owns this number"
-- as its first, preferred resolution path (see whatsapp-webhook), falling back to matching the
-- sender's phone across all schools' guardians only when no row here claims the inbound number.
-- That fallback is exactly today's (imperfect, documented) behavior; this table is what turns it
-- into an opt-in-per-school upgrade instead of a rewrite later.
create table channel_numbers (
  id uuid primary key default gen_random_uuid(),
  school_id uuid not null references schools(id) on delete cascade,
  channel text not null default 'whatsapp' check (channel in ('whatsapp')),
  phone_number text not null, -- E.164, no "whatsapp:" prefix -- matched against Twilio's `To` param
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (phone_number) -- one school owns a given number; two schools cannot share a row (the
    -- *absence* of a row is how today's shared-number fallback stays possible)
);
comment on table channel_numbers is 'Which school owns which messaging-channel phone number. Empty today (single shared WhatsApp number, see school_whatsapp_settings / TWILIO_WHATSAPP_FROM) -- populated per school as dedicated Twilio senders are provisioned. Provisioning a row is an ops/billing action, not a self-service staff one, hence no client insert policy below.';

create trigger trg_channel_numbers_updated_at
  before update on channel_numbers
  for each row execute function set_updated_at();

alter table channel_numbers enable row level security;

create index channel_numbers_school_idx on channel_numbers (school_id);

create policy channel_numbers_select on channel_numbers for select
  using (school_id = auth_school_id() and auth_has_permission('communication.read'));
-- No client insert/update/delete policy -- provisioned via the service role (or a future
-- super-admin tool) when a school's dedicated number is set up, same reasoning as
-- school_whatsapp_settings' insert path.

-- ----------------------------------------------------------------------------
-- 4. Audit trail for staff actions on a conversation (claim/close/reopen/assign). Reuses the
-- existing generic audit_row_change() trigger (phase17) rather than hand-writing audit inserts
-- into actions.ts/the Edge Function -- whatsapp_conversations has its own school_id column, so it
-- takes the same base trigger every other directly-client-writable table uses. Correct actor
-- attribution depends on the write happening under the staff member's own session (auth.uid()),
-- which is already true for the direct client updates in communication/actions.ts (claim/close/
-- reopen) and is why whatsapp-send-reply's conversation update switches from the service-role
-- client to the caller's own client (see that function) -- the message insert itself still needs
-- the service role, since it has to reach Twilio first.
create trigger trg_audit_whatsapp_conversations
  after insert or update or delete on whatsapp_conversations
  for each row execute function public.audit_row_change();
