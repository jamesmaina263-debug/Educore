-- Fix: broadcast_platform_announcement's single INSERT ... SELECT over every active
-- school_users row fails entirely (whole statement rolls back) if any row has a null
-- school_id -- and exactly one does: the platform super-admin's own school_users row
-- (super admins aren't tied to a single school). Excluding null-school_id rows from the
-- broadcast audience: the platform admin sending the broadcast doesn't need an in-app
-- bell notification about their own announcement, and notification_logs.school_id is
-- NOT NULL (broadcasting to "no school" isn't a meaningful notification target anyway).

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
