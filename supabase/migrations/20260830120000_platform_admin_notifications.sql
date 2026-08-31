-- Platform-level admin notifications: a new demo request needs a super admin's attention.
--
-- Deliberately NOT reusing notification_logs/queue_communication: that whole system requires a
-- real, non-null school_id and a school user with communication.write permission on that school
-- (see queue_communication() in 20260810064531_phase9_communication_check.sql). A platform
-- super admin has school_id = null by design (confirmed live: admin@educore.co.ke's
-- school_users row has school_id null), so this needs its own parallel, platform-scoped table.

create extension if not exists pg_net;

create table public.platform_notifications (
  id uuid primary key default gen_random_uuid(),
  kind text not null check (kind in ('demo_request')),
  title text not null,
  body text not null,
  action_path text,
  related_table text,
  related_id uuid,
  created_at timestamptz not null default now(),
  -- Shared read-state, not per-admin: there is exactly one platform admin today
  -- (admin@educore.co.ke). If a second super admin is added later, any one of them
  -- marking a notification read will hide it for all of them -- revisit with a
  -- per-user junction table at that point, not before it's a real problem.
  read_at timestamptz,
  read_by uuid references auth.users(id)
);

create index idx_platform_notifications_created_at on public.platform_notifications(created_at desc);

alter table public.platform_notifications enable row level security;

create policy platform_notifications_select on public.platform_notifications
  for select using (public.auth_is_super_admin());

-- No client insert/update policy -- rows are only ever created by the trigger below
-- (security definer) and marked read via the RPC below, same pattern as notification_logs.

create or replace function public.mark_platform_notification_read(p_notification_id uuid)
returns void
language plpgsql security definer set search_path to 'public'
as $$
begin
  if not public.auth_is_super_admin() then
    raise exception 'Not authorized.';
  end if;
  update public.platform_notifications
    set read_at = now(), read_by = auth.uid()
    where id = p_notification_id and read_at is null;
end;
$$;

create or replace function public.clear_all_platform_notifications()
returns void
language plpgsql security definer set search_path to 'public'
as $$
begin
  if not public.auth_is_super_admin() then
    raise exception 'Not authorized.';
  end if;
  update public.platform_notifications
    set read_at = now(), read_by = auth.uid()
    where read_at is null;
end;
$$;

-- A random per-project secret, generated once here and never displayed or logged anywhere
-- outside this migration. It authenticates the pg_net -> edge function call below: the
-- notify-platform-admin edge function has verify_jwt = false (it's called from a trigger, not
-- a user session, so it can't present a Supabase JWT), so this shared secret is what stops the
-- endpoint from being a fully open webhook. The edge function must be deployed with a
-- PLATFORM_NOTIFICATION_WEBHOOK_SECRET env var holding this same value (see its README/deploy
-- notes) before this will actually authenticate successfully -- until then the email leg
-- fails closed (401) while the in-app notification row still gets created either way.
select vault.create_secret(
  encode(gen_random_bytes(32), 'hex'),
  'platform_notification_webhook_secret'
);

create or replace function public.notify_admin_new_demo_request()
returns trigger
language plpgsql security definer set search_path to 'public'
as $$
declare
  v_webhook_secret text;
  v_project_url text := 'https://alzqlvfaftwegptfbfej.supabase.co';
begin
  insert into public.platform_notifications (kind, title, body, action_path, related_table, related_id)
  values (
    'demo_request',
    'New demo request',
    coalesce(new.school_name, new.name) || ' (' || new.name || ') requested a demo',
    '/admin/demo-requests',
    'marketing_demo_requests',
    new.id
  );

  select decrypted_secret into v_webhook_secret
    from vault.decrypted_secrets
    where name = 'platform_notification_webhook_secret';

  -- pg_net queues this asynchronously and returns immediately -- a slow or failing email
  -- provider never blocks or fails the demo request insert itself. If v_webhook_secret is
  -- somehow missing, net.http_post still fires (the edge function will just 401 it) rather
  -- than raising here and rolling back the notification row above.
  perform net.http_post(
    url := v_project_url || '/functions/v1/notify-platform-admin',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-webhook-secret', coalesce(v_webhook_secret, '')
    ),
    body := jsonb_build_object(
      'kind', 'demo_request',
      'name', new.name,
      'school_name', new.school_name,
      'email', new.email,
      'phone', new.phone,
      'student_count', new.student_count,
      'message', new.message,
      'demo_request_id', new.id
    )
  );

  return new;
end;
$$;

create trigger trg_notify_admin_new_demo_request
  after insert on public.marketing_demo_requests
  for each row execute function public.notify_admin_new_demo_request();
