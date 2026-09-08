-- System health / error digest, in-app half. sendSecurityAlert() (src/lib/security-alert.ts
-- and its Deno mirror, supabase/functions/_shared/securityAlert.ts) already pushes these
-- events to Slack when SECURITY_ALERT_WEBHOOK_URL is configured -- but Slack is push-only and
-- easy to miss in a busy channel, and nothing durable exists if you want to look back at "what
-- broke this week" from the admin console itself. This table is that durable side: both alert
-- helpers get a companion write here (added in the same change), so the same event lands in
-- both places from one call site, and neither channel is the only copy.
--
-- No read/unread tracking (unlike platform_notifications, which is a to-do queue for demo
-- requests) -- this is a log to scan, not an inbox to clear.
create table public.platform_alerts (
  id uuid primary key default gen_random_uuid(),
  event text not null,
  detail jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index idx_platform_alerts_created_at on public.platform_alerts (created_at desc);

alter table public.platform_alerts enable row level security;

-- Select-only for super_admin -- matches platform_notifications_select's exact shape. Writes
-- only ever happen via the service-role client both sendSecurityAlert() variants already use
-- (bypasses RLS entirely, same as every other service-role write in this codebase), so there's
-- deliberately no insert policy for anon/authenticated here.
create policy platform_alerts_select
  on public.platform_alerts
  for select
  using (auth_is_super_admin());

revoke insert, update, delete, truncate on public.platform_alerts from anon, authenticated;
