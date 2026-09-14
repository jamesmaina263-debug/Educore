-- Auto-reconciled by scripts/reconcile_migration_drift.py: this version was applied directly to production without a matching git commit at the time. Content below is byte-for-byte what's recorded in supabase_migrations.schema_migrations for version 20260908110441 -- reconstructed, not rewritten.

create or replace function public.broadcast_platform_announcement(p_subject text, p_body text)
returns integer
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_count integer;
begin
  if not (auth_is_super_admin() or auth.role() = 'service_role') then
    raise exception 'Not authorized to broadcast a platform announcement.';
  end if;

  if coalesce(trim(p_subject), '') = '' then
    raise exception 'Subject is required.';
  end if;
  if coalesce(trim(p_body), '') = '' then
    raise exception 'Body is required.';
  end if;

  insert into public.notification_logs
    (school_id, recipient_type, channel, recipient_school_user_id, subject, body, status, source_module)
  select su.school_id, 'staff', 'in_app', su.id, p_subject, p_body, 'sent', 'platform_announcement'
  from public.school_users su
  where su.status = 'active';

  get diagnostics v_count = row_count;
  return v_count;
end;
$$;
revoke all on function public.broadcast_platform_announcement(text, text) from public;
grant execute on function public.broadcast_platform_announcement(text, text) to authenticated;

create or replace function public.get_platform_announcement_history()
returns table(subject text, body text, sent_at timestamptz, recipient_count bigint)
language plpgsql
security definer
set search_path to 'public'
as $$
begin
  if not (auth_is_super_admin() or auth.role() = 'service_role') then
    raise exception 'Not authorized to view platform announcement history.';
  end if;

  return query
  select nl.subject, nl.body, nl.created_at as sent_at, count(*) as recipient_count
  from public.notification_logs nl
  where nl.source_module = 'platform_announcement'
  group by nl.subject, nl.body, nl.created_at
  order by nl.created_at desc
  limit 20;
end;
$$;
revoke all on function public.get_platform_announcement_history() from public;
grant execute on function public.get_platform_announcement_history() to authenticated;
