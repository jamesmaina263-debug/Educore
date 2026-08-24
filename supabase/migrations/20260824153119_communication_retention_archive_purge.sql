-- Communication retention: archive after 7 days, permanently purge 7 days after that (14 days
-- total), plus an immediate "delete permanently" action for staff who don't want to wait.
--
-- Two communication surfaces exist today and both grow unbounded with no cleanup:
--   notification_logs      -- one row per outbound SMS/email/WhatsApp/in-app broadcast attempt
--   whatsapp_conversations  -- two-way WhatsApp threads (whatsapp_messages cascades with its
--                              conversation via the existing ON DELETE CASCADE, so a thread
--                              archives/purges as a unit -- individual messages don't get their
--                              own lifecycle columns)
--
-- archived_at/purge_at are nullable and default null, so this is purely additive: every existing
-- row, query, and RLS policy on these two tables keeps working exactly as before. No existing
-- SELECT/INSERT policy references these columns, so nothing already-working is affected.
--
-- archive_old_communications() and purge_expired_communications() are meant to be called daily by
-- /api/cron/communication-retention (see vercel.json) -- same shape as expire_trials() /
-- mark_invoices_overdue() in 20260805034059_billing_lifecycle_functions.sql.

alter table notification_logs
  add column archived_at timestamptz,
  add column purge_at timestamptz;
comment on column notification_logs.archived_at is
  'Set by archive_old_communications() 7 days after created_at. Null = still active.';
comment on column notification_logs.purge_at is
  'When this row becomes eligible for permanent deletion by purge_expired_communications() -- normally archived_at + 7 days, brought forward by delete_communication_permanently() for an immediate manual delete.';

alter table whatsapp_conversations
  add column archived_at timestamptz,
  add column purge_at timestamptz;
comment on column whatsapp_conversations.archived_at is
  'Set by archive_old_communications() 7 days after last_message_at. Null = still active. whatsapp_messages has no lifecycle columns of its own -- a thread archives/purges as a unit and its messages cascade-delete with it.';
comment on column whatsapp_conversations.purge_at is
  'When this conversation (and its messages, via ON DELETE CASCADE) becomes eligible for permanent deletion by purge_expired_communications() -- normally archived_at + 7 days, brought forward by delete_communication_permanently() for an immediate manual delete.';

create index notification_logs_purge_idx on notification_logs (purge_at) where purge_at is not null;
create index whatsapp_conversations_purge_idx on whatsapp_conversations (purge_at) where purge_at is not null;

-- New permission: manually forcing a permanent delete is a step above communication.write
-- (composing/sending) -- restricted to the same tier as students.delete by default
-- (school_owner/principal), matching delete_student_permanently's precedent for irreversible
-- actions. Purely additive insert; existing communication.read/write/supplier grants are untouched.
insert into role_permissions (role_id, school_id, permission_key, allowed)
select r.id, null, 'communication.delete', true
from roles r
where r.name in ('school_owner', 'principal')
on conflict do nothing;

-- ---------------------------------------------------------------------------
-- archive_old_communications(): daily sweep. Idempotent (only touches archived_at is null rows),
-- safe to re-run if a cron invocation fails partway or runs twice.
-- ---------------------------------------------------------------------------
create or replace function public.archive_old_communications()
returns integer
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_notif_count integer;
  v_wa_count integer;
begin
  if not (auth_is_super_admin() or auth.role() = 'service_role') then
    raise exception 'Not authorized to archive communications.';
  end if;

  update notification_logs
    set archived_at = now(), purge_at = now() + interval '7 days'
    where archived_at is null and created_at < now() - interval '7 days';
  get diagnostics v_notif_count = row_count;

  update whatsapp_conversations
    set archived_at = now(), purge_at = now() + interval '7 days'
    where archived_at is null and last_message_at < now() - interval '7 days';
  get diagnostics v_wa_count = row_count;

  return v_notif_count + v_wa_count;
end;
$$;
comment on function public.archive_old_communications() is
  'Marks notification_logs rows and whatsapp_conversations threads inactive for 7+ days as archived, scheduling permanent deletion 7 days later. Idempotent -- safe to re-run. Intended to be called daily by /api/cron/communication-retention.';
revoke all on function public.archive_old_communications() from public;
grant execute on function public.archive_old_communications() to authenticated;

-- ---------------------------------------------------------------------------
-- purge_expired_communications(): daily sweep, hard-deletes anything past purge_at. Snapshots a
-- compact, PII-minimized summary to audit_log first -- never the full message body or full phone
-- number, since a purge is explicitly meant to remove that data from storage, not relocate it
-- permanently into a different table.
-- ---------------------------------------------------------------------------
create or replace function public.purge_expired_communications()
returns integer
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_notif_count integer;
  v_wa_count integer;
  r record;
begin
  if not (auth_is_super_admin() or auth.role() = 'service_role') then
    raise exception 'Not authorized to purge communications.';
  end if;

  for r in
    select id, school_id, channel, status, created_at
    from notification_logs
    where purge_at is not null and purge_at <= now()
  loop
    insert into audit_log (school_id, table_name, record_id, action, old_data)
    values (r.school_id, 'notification_logs', r.id, 'auto_purge',
      jsonb_build_object('channel', r.channel, 'status', r.status, 'created_at', r.created_at));
  end loop;
  delete from notification_logs where purge_at is not null and purge_at <= now();
  get diagnostics v_notif_count = row_count;

  for r in
    select id, school_id, phone_number, status, created_at
    from whatsapp_conversations
    where purge_at is not null and purge_at <= now()
  loop
    insert into audit_log (school_id, table_name, record_id, action, old_data)
    values (r.school_id, 'whatsapp_conversations', r.id, 'auto_purge', jsonb_build_object(
      -- keep only enough of the phone number to identify country/prefix, not the full parent
      -- number, in a record explicitly meant to outlive the conversation itself
      'phone_number_prefix', left(r.phone_number, 6) || 'xxxx',
      'status', r.status,
      'message_count', (select count(*) from whatsapp_messages where conversation_id = r.id),
      'created_at', r.created_at
    ));
  end loop;
  delete from whatsapp_conversations where purge_at is not null and purge_at <= now(); -- whatsapp_messages cascades
  get diagnostics v_wa_count = row_count;

  return v_notif_count + v_wa_count;
end;
$$;
comment on function public.purge_expired_communications() is
  'Hard-deletes notification_logs rows and whatsapp_conversations threads (with their messages, via cascade) past purge_at. Writes a compact, PII-minimized summary to audit_log first (never the full message body or phone number) so there is a forensic trail without defeating the purpose of the purge. Intended to be called daily by /api/cron/communication-retention.';
revoke all on function public.purge_expired_communications() from public;
grant execute on function public.purge_expired_communications() to authenticated;

-- ---------------------------------------------------------------------------
-- delete_communication_permanently(): the manual "delete now" button. Works on either an active
-- or already-archived row/thread, for a user who doesn't want to wait out the 7/14-day schedule.
-- Gated on communication.delete (school_owner/principal by default) -- separate from
-- communication.write, since the ability to send a message doesn't imply the ability to
-- permanently destroy the record of one. Scoped to the caller's own school via auth_school_id(),
-- same as every other RLS-equivalent check in this codebase's SECURITY DEFINER functions.
-- ---------------------------------------------------------------------------
create or replace function public.delete_communication_permanently(p_table text, p_id uuid, p_reason text default null)
returns void
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_school_id uuid;
  v_actor uuid;
begin
  if not auth_has_permission('communication.delete') then
    raise exception 'Not authorized to permanently delete communications.';
  end if;
  if p_table not in ('notification_logs', 'whatsapp_conversations') then
    raise exception 'Unsupported record type.';
  end if;

  v_actor := auth_school_user_id();

  if p_table = 'notification_logs' then
    select school_id into v_school_id from notification_logs where id = p_id and school_id = auth_school_id() for update;
    if not found then
      raise exception 'Record not found.';
    end if;
    insert into audit_log (school_id, actor_school_user_id, table_name, record_id, action, reason, old_data)
    select v_school_id, v_actor, 'notification_logs', p_id, 'manual_delete', p_reason,
      jsonb_build_object('channel', channel, 'status', status, 'created_at', created_at)
    from notification_logs where id = p_id;
    delete from notification_logs where id = p_id;
  else
    select school_id into v_school_id from whatsapp_conversations where id = p_id and school_id = auth_school_id() for update;
    if not found then
      raise exception 'Record not found.';
    end if;
    insert into audit_log (school_id, actor_school_user_id, table_name, record_id, action, reason, old_data)
    select v_school_id, v_actor, 'whatsapp_conversations', p_id, 'manual_delete', p_reason,
      jsonb_build_object(
        'phone_number_prefix', left(phone_number, 6) || 'xxxx',
        'status', status,
        'message_count', (select count(*) from whatsapp_messages where conversation_id = p_id),
        'created_at', created_at
      )
    from whatsapp_conversations where id = p_id;
    delete from whatsapp_conversations where id = p_id; -- whatsapp_messages cascades
  end if;
end;
$$;
comment on function public.delete_communication_permanently(text, uuid, text) is
  'Immediately and irreversibly deletes one notification_logs row or one whatsapp_conversations thread (with its messages), bypassing the 7/14-day archive schedule. Restricted to communication.delete (school_owner/principal by default). Writes a PII-minimized snapshot to audit_log first, same pattern as delete_student_permanently.';
revoke all on function public.delete_communication_permanently(text, uuid, text) from public;
grant execute on function public.delete_communication_permanently(text, uuid, text) to authenticated;
