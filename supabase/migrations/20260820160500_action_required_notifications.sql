-- Action-required in-app notifications.
--
-- The topbar bell already reads notification_logs (channel = 'in_app'), but
-- nothing in the app besides the broadcast communication tool could create a
-- row there, and queue_communication() requires communication.write -- a
-- permission ordinary staff (e.g. someone requesting their own leave) don't
-- and shouldn't have. Workflow notifications ("your leave was approved",
-- "a leave request needs your approval") are a different thing from a
-- broadcast announcement: they're system-generated, scoped to one recipient
-- or one permission-holding group, and triggered by an action the caller was
-- already authorized to take. These two functions cover that case without
-- touching queue_communication or its permission gate.

-- 1. Let a notification carry a link to the thing that needs attention.
alter table public.notification_logs
  add column if not exists action_url text;

comment on column public.notification_logs.action_url is
  'In-app relative path (e.g. /staff/{id}?tab=leave) the notification should open when clicked. Null for purely informational notifications.';

-- 2. Notify one specific school_user. Used for "your request was
-- approved/rejected" type outcomes, and is the primitive the group function
-- below builds on. No permission gate beyond "recipient must be in the
-- caller's school" -- this only ever fires as a side effect of an action the
-- caller already had to be authorized to perform (e.g. respondToLeaveRequest
-- already required staff.leave.approve before calling this).
create or replace function public.notify_school_user(
  p_recipient_id uuid,
  p_subject text,
  p_body text,
  p_action_url text default null,
  p_category text default 'other'
)
returns uuid
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_school_id uuid := auth_school_id();
  v_sender uuid := auth_school_user_id();
  v_id uuid;
begin
  if v_school_id is null then
    raise exception 'Could not resolve your school.';
  end if;
  if not exists (
    select 1 from school_users where id = p_recipient_id and school_id = v_school_id
  ) then
    raise exception 'Recipient is not in your school.';
  end if;
  if not notification_allowed(p_recipient_id, p_category, 'in_app') then
    return null;
  end if;

  insert into notification_logs (
    school_id, recipient_school_user_id, recipient_phone, recipient_type,
    channel, subject, body, action_url, status, segments, sent_by
  )
  values (
    v_school_id, p_recipient_id, '-', 'staff',
    'in_app', p_subject, p_body, p_action_url, 'delivered', 1, v_sender
  )
  returning id into v_id;

  return v_id;
end;
$$;

revoke all on function public.notify_school_user(uuid, text, text, text, text) from public, anon;
grant execute on function public.notify_school_user(uuid, text, text, text, text) to authenticated;

-- 3. Notify every active school_user in the caller's school who effectively
-- holds a given permission (role default, school-level role override, or
-- per-user override -- same precedence as auth_has_permission()). Used for
-- "someone needs to act" notifications, e.g. everyone who can approve leave
-- when a new request comes in.
create or replace function public.notify_users_with_permission(
  p_permission_key text,
  p_subject text,
  p_body text,
  p_action_url text default null,
  p_category text default 'other',
  p_exclude_self boolean default true
)
returns integer
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_school_id uuid := auth_school_id();
  v_caller uuid := auth_school_user_id();
  v_count integer := 0;
  v_recipient record;
begin
  if v_school_id is null then
    raise exception 'Could not resolve your school.';
  end if;

  for v_recipient in
    select su.id
    from school_users su
    where su.school_id = v_school_id
      and su.status = 'active'
      and (not p_exclude_self or su.id is distinct from v_caller)
      and coalesce(
        (select upo.allowed from user_permission_overrides upo
          where upo.school_user_id = su.id and upo.permission_key = p_permission_key),
        (select rp.allowed from role_permissions rp
          where rp.role_id = su.role_id and rp.school_id = v_school_id and rp.permission_key = p_permission_key),
        (select rp.allowed from role_permissions rp
          where rp.role_id = su.role_id and rp.school_id is null and rp.permission_key = p_permission_key),
        false
      )
  loop
    if notification_allowed(v_recipient.id, p_category, 'in_app') then
      insert into notification_logs (
        school_id, recipient_school_user_id, recipient_phone, recipient_type,
        channel, subject, body, action_url, status, segments, sent_by
      )
      values (
        v_school_id, v_recipient.id, '-', 'staff',
        'in_app', p_subject, p_body, p_action_url, 'delivered', 1, v_caller
      );
      v_count := v_count + 1;
    end if;
  end loop;

  return v_count;
end;
$$;

revoke all on function public.notify_users_with_permission(text, text, text, text, text, boolean) from public, anon;
grant execute on function public.notify_users_with_permission(text, text, text, text, text, boolean) to authenticated;

-- notification_logs.recipient_phone is `not null`; in-app rows have no phone,
-- so both functions above write a '-' placeholder. Make that legitimate
-- rather than a workaround: recipient_phone is only ever meaningful for
-- sms/whatsapp anyway (the existing recipient_matches_channel check already
-- doesn't require it for in_app).
alter table public.notification_logs alter column recipient_phone drop not null;

alter table public.notification_logs
  drop constraint if exists notification_logs_recipient_matches_channel;
alter table public.notification_logs add constraint notification_logs_recipient_matches_channel check (
  (channel = 'email' and recipient_email is not null)
  or (channel in ('sms','whatsapp') and recipient_phone is not null)
  or (channel = 'in_app' and recipient_school_user_id is not null)
);
