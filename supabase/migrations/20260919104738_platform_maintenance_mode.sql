-- Platform-wide maintenance mode: a manual on/off switch platform admins can flip while
-- carrying out planned maintenance (the same kind of window /admin/broadcast already lets them
-- announce -- see 20260908070000_platform_broadcast_announcements). Broadcasting only tells
-- staff a window is coming; it doesn't stop anyone from actually using the app during it. This
-- adds the actual kill switch: when enabled, every school-facing staff route is blocked
-- (redirected to /maintenance) by src/lib/supabase/middleware.ts, while the platform admin
-- console (/admin/*), the parent/student portal, and the marketing site stay reachable -- so
-- whoever flipped it on can always flip it back off.
--
-- Singleton table (single fixed-id row) rather than reusing platform_feature_flags: this isn't
-- per-school or opt-in, it's one platform-wide state, and it must be readable pre-auth (by
-- anon) since the middleware gate has to evaluate it on every request, logged in or not -- a
-- shape platform_feature_flags' RLS (super_admin-or-your-own-school) doesn't support and
-- shouldn't be loosened just for this.

create table public.platform_maintenance (
  id integer primary key default 1,
  enabled boolean not null default false,
  message text,
  updated_at timestamptz not null default now(),
  updated_by uuid,
  constraint platform_maintenance_singleton check (id = 1)
);

insert into public.platform_maintenance (id, enabled) values (1, false);

comment on table public.platform_maintenance is
  'Single-row platform-wide maintenance kill switch. Read by the middleware gate on every request (must stay readable by anon); written only via /admin/broadcast''s maintenance toggle.';

alter table public.platform_maintenance enable row level security;

-- Readable by anyone, including anon -- the middleware gate runs before auth is known and
-- needs this to decide whether to block. Nothing in this row is sensitive (a boolean + an
-- admin-authored message).
create policy platform_maintenance_select on public.platform_maintenance
  for select using (true);

-- Only super_admin (or the service role) can flip it.
create policy platform_maintenance_update on public.platform_maintenance
  for update using (auth_is_super_admin() or auth.role() = 'service_role')
  with check (auth_is_super_admin() or auth.role() = 'service_role');

revoke all on public.platform_maintenance from public;
grant select on public.platform_maintenance to anon, authenticated;
grant update on public.platform_maintenance to authenticated;
