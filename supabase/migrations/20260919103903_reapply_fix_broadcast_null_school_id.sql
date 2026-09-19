-- Re-apply: the live broadcast_platform_announcement function had silently drifted back to the
-- pre-fix version (no `su.school_id is not null` filter), even though migration
-- 20260910031006_fix_broadcast_null_school_id is recorded as applied in schema_migrations.
-- Root cause of the drift is unclear (likely a later un-migrated direct DDL run), but the fix
-- itself is identical to that migration's intent: exclude school_users rows with a null
-- school_id (the platform super-admin's own row) from the broadcast audience, since
-- notification_logs.school_id is NOT NULL.

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
  where su.status = 'active'
    and su.school_id is not null;

  get diagnostics v_count = row_count;
  return v_count;
end;
$$;
revoke all on function public.broadcast_platform_announcement(text, text) from public;
grant execute on function public.broadcast_platform_announcement(text, text) to authenticated;
