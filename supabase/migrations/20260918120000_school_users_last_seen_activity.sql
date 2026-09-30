-- Fixes the admin console's "Last active" school health signal, which today is sourced
-- entirely from auth.users.last_sign_in_at (see admin_school_last_active(), migration
-- 20260901230200). That column is only written by GoTrue at the moment of a real sign-in
-- (password grant, magic link, OTP, OAuth callback) -- it is NOT touched when an already
-- signed-in user's session is silently refreshed, which is what happens on every request
-- via proxy.ts's supabase.auth.getUser() call. Net effect: a school whose staff logged in
-- once and have kept a live session ever since shows a "Last active Nd ago" that gets
-- staler by the day even while they use the app constantly today.
--
-- Fix: track real usage in school_users.last_seen_at, bumped by a throttled ping from the
-- proxy layer (see proxy.ts / lib/supabase/middleware.ts), and have the admin visibility
-- function report whichever signal -- login or usage -- is more recent.

alter table public.school_users
  add column last_seen_at timestamptz;

comment on column public.school_users.last_seen_at is
  'Last time this user was actively using the app (proxy-layer ping, throttled to roughly '
  'once every 5 minutes per user) -- distinct from auth.users.last_sign_in_at, which only '
  'moves on an actual sign-in and stays frozen across a long-lived refreshed session.';

-- Bumps the caller's own last_seen_at, at most once per THROTTLE_MINUTES. SECURITY DEFINER
-- so it can run from an authenticated (non-staff.manage) user's own request without needing
-- a school_users UPDATE grant beyond their own row, and so the throttle check + write happen
-- as one atomic statement rather than a read-then-write the proxy layer would otherwise need
-- to do on every single request just to decide whether to write.
create or replace function public.bump_last_seen()
returns void
language plpgsql
security definer
set search_path to 'public'
as $$
begin
  if auth.uid() is null then
    return;
  end if;

  update public.school_users
  set last_seen_at = now()
  where auth_user_id = auth.uid()
    and (last_seen_at is null or last_seen_at < now() - interval '5 minutes');
end;
$$;

revoke all on function public.bump_last_seen() from public;
grant execute on function public.bump_last_seen() to authenticated;

-- Report the more recent of the two signals per school. greatest() ignores nulls (only
-- null if every argument is null), so a school with logins but no recorded pings yet (or
-- vice versa) still gets a real value instead of losing the row.
create or replace function public.admin_school_last_active()
returns table (school_id uuid, last_active_at timestamptz)
language plpgsql
security definer
set search_path to 'public'
as $$
begin
  if not (auth_is_super_admin() or auth.role() = 'service_role') then
    raise exception 'Not authorized to view school activity.';
  end if;

  return query
    select su.school_id, max(greatest(u.last_sign_in_at, su.last_seen_at)) as last_active_at
    from public.school_users su
    join auth.users u on u.id = su.auth_user_id
    where su.school_id is not null
    group by su.school_id;
end;
$$;
