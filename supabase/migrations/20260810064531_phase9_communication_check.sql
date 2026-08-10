-- ============================================================
-- Phase 9: Communication Infrastructure Check
-- Adds the missing "in_app" channel (the topbar bell was purely
-- decorative — no data behind it), a proper recipient identity on
-- notification_logs so a user can query "my notifications" reliably,
-- and read-status tracking. SMS/Email/WhatsApp dispatch, templates,
-- delivery-status, and notification preferences all already existed
-- and are left as-is — this phase closes the one real gap, it does
-- not rebuild the module.
-- ============================================================

-- 1. Recipient identity + read tracking on notification_logs.
-- recipient_school_user_id was already computed inside queue_communication
-- (used only for the preference check) but never stored — every existing
-- row for this school lacks it, so it is left null for old rows rather
-- than guessed at from phone/email.
alter table public.notification_logs
  add column if not exists recipient_school_user_id uuid references public.school_users(id),
  add column if not exists read_at timestamptz;

create index if not exists idx_notification_logs_recipient on public.notification_logs(recipient_school_user_id) where recipient_school_user_id is not null;

-- 2. Widen channel to include in_app.
alter table public.notification_logs drop constraint notification_logs_channel_check;
alter table public.notification_logs add constraint notification_logs_channel_check check (channel in ('sms','email','whatsapp','in_app'));

alter table public.communication_templates drop constraint communication_templates_channel_check;
alter table public.communication_templates add constraint communication_templates_channel_check check (channel in ('sms','email','whatsapp','in_app'));

-- 3. Self-read RLS: a recipient can see their own in-app notifications.
-- Consolidated into the existing select policy (one OR'd policy per
-- table, not two narrow ones stacked) per this project's established
-- multiple_permissive_policies convention.
drop policy notification_logs_select on public.notification_logs;
create policy notification_logs_select on public.notification_logs
  for select using (
    (school_id = auth_school_id() and auth_has_permission('communication.read'))
    or (recipient_school_user_id = (select id from school_users where auth_user_id = auth.uid()))
  );

-- 4. Mark-as-read: a security-definer RPC rather than a client-facing
-- UPDATE policy (matches the existing pattern — notification_logs has no
-- client UPDATE policy at all; status transitions are a system concern).
-- Scoped to the caller's own row only.
create or replace function public.mark_notification_read(p_notification_id uuid)
returns void
language plpgsql security definer set search_path to 'public'
as $$
declare
  v_me uuid := (select id from school_users where auth_user_id = auth.uid());
begin
  update notification_logs
  set read_at = now()
  where id = p_notification_id and recipient_school_user_id = v_me and read_at is null;
end;
$$;

revoke all on function public.mark_notification_read(uuid) from public, anon;
grant execute on function public.mark_notification_read(uuid) to authenticated;

-- 5. queue_communication: accept in_app, always store recipient_school_user_id
-- (previously computed and discarded after the preference check), and
-- deliver in-app messages immediately (status='delivered') since there is
-- no external provider step — an in-app row IS the delivery.
create or replace function public.queue_communication(p_recipients jsonb, p_template_id uuid DEFAULT NULL::uuid, p_body text DEFAULT NULL::text, p_channel text DEFAULT 'sms'::text, p_subject text DEFAULT NULL::text, p_category text DEFAULT NULL::text)
returns integer
language plpgsql security definer set search_path to 'public'
as $$
declare
  v_school_id uuid := auth_school_id();
  v_sender uuid;
  v_template_body text;
  v_template_category text;
  v_effective_category text;
  v_recipient jsonb;
  v_rendered text;
  v_recipient_school_user_id uuid;
  v_count integer := 0;
begin
  if not auth_has_permission('communication.write') then
    raise exception 'Not authorized to send communications.';
  end if;
  if p_template_id is null and p_body is null then
    raise exception 'Either a template or a message body is required.';
  end if;
  if p_channel not in ('sms','email','whatsapp','in_app') then
    raise exception 'channel must be sms, email, whatsapp, or in_app';
  end if;

  if p_template_id is not null then
    select body, category into v_template_body, v_template_category
      from communication_templates where id = p_template_id and school_id = v_school_id;
    if v_template_body is null then
      raise exception 'Template not found.';
    end if;
  end if;

  v_effective_category := coalesce(p_category, v_template_category);

  select id into v_sender from school_users where auth_user_id = auth.uid();

  for v_recipient in select * from jsonb_array_elements(p_recipients) loop
    v_rendered := render_template(coalesce(v_template_body, p_body), coalesce(v_recipient->'values', '{}'::jsonb));
    v_recipient_school_user_id := nullif(v_recipient->>'school_user_id', '')::uuid;

    if p_channel = 'email' and nullif(v_recipient->>'email', '') is null then
      continue;
    end if;
    if p_channel in ('sms','whatsapp') and nullif(v_recipient->>'phone', '') is null then
      continue;
    end if;
    if p_channel = 'in_app' and v_recipient_school_user_id is null then
      continue;
    end if;

    if v_effective_category is not null and v_recipient_school_user_id is not null
       and not notification_allowed(v_recipient_school_user_id, v_effective_category, p_channel) then
      continue;
    end if;

    insert into notification_logs (
      school_id, student_id, recipient_phone, recipient_email, recipient_school_user_id, recipient_type,
      channel, template_id, subject, body, status, segments, sent_by
    )
    values (
      v_school_id,
      nullif(v_recipient->>'student_id', '')::uuid,
      nullif(v_recipient->>'phone', ''),
      nullif(v_recipient->>'email', ''),
      v_recipient_school_user_id,
      coalesce(v_recipient->>'recipient_type', 'guardian'),
      p_channel,
      p_template_id,
      p_subject,
      v_rendered,
      case when p_channel = 'in_app' then 'delivered' else 'queued' end,
      case when p_channel = 'sms' then greatest(1, ceil(length(v_rendered)::numeric / 160))::smallint else 1 end,
      v_sender
    );
    v_count := v_count + 1;
  end loop;

  return v_count;
end;
$$;
