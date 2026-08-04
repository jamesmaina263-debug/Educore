
create table communication_templates (
  id uuid primary key default gen_random_uuid(),
  school_id uuid not null references schools(id) on delete cascade,
  name text not null,
  channel text not null default 'sms' check (channel in ('sms')), -- email/whatsapp are Phase 2+ per blueprint 7.6, schema stays open to add them as a channel value later without a new table
  category text not null check (category in ('fee_reminder', 'absence_alert', 'result_published', 'announcement', 'other')),
  body text not null, -- may contain {{student_name}}, {{balance}}, {{school_name}} placeholders
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
comment on table communication_templates is 'Reusable SMS templates with {{placeholder}} substitution — without this every message is hand-typed (blueprint Part H).';

create table notification_logs (
  id uuid primary key default gen_random_uuid(),
  school_id uuid not null references schools(id) on delete cascade,
  student_id uuid references students(id) on delete set null, -- null for a broadcast/staff announcement not tied to one student
  recipient_phone text not null,
  recipient_type text not null check (recipient_type in ('guardian', 'student', 'staff')),
  channel text not null default 'sms' check (channel in ('sms')),
  template_id uuid references communication_templates(id) on delete set null,
  body text not null, -- the final rendered message, not the template — so history is accurate even if the template is edited/deleted later
  status text not null default 'queued' check (status in ('queued', 'sent', 'failed', 'delivered')),
  provider_response text,
  segments smallint not null default 1, -- SMS is billed per 160-char segment; surfaced in the composer per blueprint 7.6
  sent_by uuid references school_users(id), -- null for system-triggered sends (e.g. the 3-day absence-alert rule)
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
comment on table notification_logs is 'Every SMS attempt and its outcome — without this you cannot answer "why didn''t my parent get the SMS" (blueprint Part H). status starts queued, moves to sent/failed once the provider responds.';

alter table communication_templates enable row level security;
alter table notification_logs enable row level security;

create index communication_templates_school_id_idx on communication_templates (school_id);
create index notification_logs_school_id_status_idx on notification_logs (school_id, status);
create index notification_logs_student_id_idx on notification_logs (student_id);
create index notification_logs_template_id_idx on notification_logs (template_id);
create index notification_logs_sent_by_idx on notification_logs (sent_by);

insert into role_permissions (role_id, school_id, permission_key, allowed)
select r.id, null, p.permission_key, true
from roles r
cross join (values ('communication.read'), ('communication.write')) as p(permission_key)
where r.name in ('bursar', 'deputy_principal', 'principal', 'school_owner');

create policy communication_templates_select on communication_templates for select
  using (school_id = auth_school_id() and auth_has_permission('communication.read'));
create policy communication_templates_insert on communication_templates for insert
  with check (school_id = auth_school_id() and auth_has_permission('communication.write'));
create policy communication_templates_update on communication_templates for update
  using (school_id = auth_school_id() and auth_has_permission('communication.write'))
  with check (school_id = auth_school_id() and auth_has_permission('communication.write'));
create policy communication_templates_delete on communication_templates for delete
  using (school_id = auth_school_id() and auth_has_permission('communication.write'));

-- notification_logs: staff with communication.read see their school's history. No guardian/student
-- read policy — a delivery log is an internal operations record (was it sent, did it fail), not
-- something a parent needs visibility into; they receive the SMS itself, not the log of it.
create policy notification_logs_select on notification_logs for select
  using (school_id = auth_school_id() and auth_has_permission('communication.read'));
-- No direct write policy — rows are only ever created by queue_communication()/the automatic
-- absence-alert trigger below, and only ever updated to sent/failed by the dispatching Edge Function
-- (via the service role, which bypasses RLS by design — that's the one legitimate bypass path here).
