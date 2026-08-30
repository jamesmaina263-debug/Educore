-- Reconciliation migration.
--
-- This version (20260830120956) was applied directly to production on
-- 2026-08-30 ~12:09 UTC without ever being committed to the repo, which
-- blocked `supabase db push` for everyone with:
--   "Remote migration versions not found in local migrations directory"
--
-- This file documents exactly what is already live in production so the
-- CLI's local/remote history lines up. Supabase's CLI treats a migration
-- whose version is already recorded in supabase_migrations.schema_migrations
-- as already-applied, so running this against prod is a no-op; it only
-- matters for fresh environments (new branches, local dev, CI) that need
-- the schema recreated from scratch.
--
-- Feature: notifies platform admins when a new marketing demo request comes
-- in — writes a row here for the in-app admin notification feed and pings
-- the `notify-platform-admin` edge function (already deployed) for an
-- external notification (e.g. email/Slack).
--
-- Known follow-up, intentionally NOT fixed in this migration (tracked
-- separately): anon/authenticated still hold the default table-level
-- INSERT/UPDATE/DELETE/TRUNCATE grants Postgres/Supabase assigns to new
-- tables, with no RLS policy covering those commands on this table. RLS's
-- default-deny currently blocks them, but the grants should be revoked
-- explicitly to match this codebase's established pattern (see the various
-- revoke_anon_execute_* migrations).

create table if not exists public.platform_notifications (
  id uuid primary key default gen_random_uuid(),
  kind text not null check (kind = 'demo_request'),
  title text not null,
  body text not null,
  action_path text,
  related_table text,
  related_id uuid,
  created_at timestamptz not null default now(),
  read_at timestamptz,
  read_by uuid references auth.users(id)
);

create index if not exists idx_platform_notifications_created_at
  on public.platform_notifications (created_at desc);

alter table public.platform_notifications enable row level security;

create policy platform_notifications_select
  on public.platform_notifications
  for select
  using (auth_is_super_admin());

create or replace function public.notify_admin_new_demo_request()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $function$
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
$function$;

drop trigger if exists trg_notify_admin_new_demo_request on public.marketing_demo_requests;

create trigger trg_notify_admin_new_demo_request
  after insert on public.marketing_demo_requests
  for each row execute function public.notify_admin_new_demo_request();
