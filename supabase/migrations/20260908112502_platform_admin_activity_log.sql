-- Auto-reconciled by scripts/reconcile_migration_drift.py: this version was applied directly to production without a matching git commit at the time. Content below is byte-for-byte what's recorded in supabase_migrations.schema_migrations for version 20260908112502 -- reconstructed, not rewritten.

create table public.platform_admin_activity_log (
  id uuid primary key default gen_random_uuid(),
  actor_user_id uuid not null,
  actor_email text,
  action text not null,
  detail jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index idx_platform_admin_activity_log_created_at on public.platform_admin_activity_log (created_at desc);

alter table public.platform_admin_activity_log enable row level security;

create policy platform_admin_activity_log_select
  on public.platform_admin_activity_log
  for select
  using (auth_is_super_admin());

revoke insert, update, delete, truncate on public.platform_admin_activity_log from anon, authenticated;

create or replace function public.log_platform_admin_action(p_action text, p_detail jsonb default '{}'::jsonb)
returns void
language plpgsql
security definer
set search_path to 'public'
as $$
begin
  if not (auth_is_super_admin() or auth.role() = 'service_role') then
    raise exception 'Not authorized to write to the platform admin activity log.';
  end if;

  insert into public.platform_admin_activity_log (actor_user_id, actor_email, action, detail)
  values (auth.uid(), auth.email(), p_action, coalesce(p_detail, '{}'::jsonb));
end;
$$;
revoke all on function public.log_platform_admin_action(text, jsonb) from public;
grant execute on function public.log_platform_admin_action(text, jsonb) to authenticated;
