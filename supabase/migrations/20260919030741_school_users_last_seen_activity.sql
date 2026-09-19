-- Auto-reconciled by scripts/reconcile_migration_drift.py: this version was applied directly to production without a matching git commit at the time. Content below is byte-for-byte what's recorded in supabase_migrations.schema_migrations for version 20260919030741 -- reconstructed, not rewritten.

alter table public.school_users
  add column last_seen_at timestamptz;

comment on column public.school_users.last_seen_at is
  'Last time this user was actively using the app (proxy-layer ping, throttled to roughly once every 5 minutes per user) -- distinct from auth.users.last_sign_in_at, which only moves on an actual sign-in and stays frozen across a long-lived refreshed session.';

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

