-- Platform-wide broadcast announcements (product updates, planned downtime, policy changes) --
-- explicitly distinct from a school's own guardian-facing `announcements` table (that one is
-- keyed to a school_users author via created_by, has no school_id=null option, and its
-- recipients are guardians -- structurally the wrong shape for "the platform owner talking to
-- every school's staff").
--
-- No new table, no new delivery mechanism: every school_user already has an in-app
-- notification bell (NotificationBell / getMyInAppNotifications(), reading
-- notification_logs where channel='in_app' and recipient_school_user_id = them, via the RLS
-- clause that already exists for that -- unrelated to and untouched by the
-- notification_logs_select revert in the communication-delivery-health correction, since that
-- clause was never part of the super_admin bypass). Broadcasting is just inserting one
-- in_app row per active school_user, tagged source_module='platform_announcement' so it can be
-- told apart from a school's own communications later (e.g. for the retention sweep, though no
-- special-casing is added there -- these age out with everything else on the normal
-- archive/purge schedule).

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

-- History view for /admin/broadcast. A narrow SECURITY DEFINER function rather than widening
-- notification_logs_select again (that bypass was deliberately reverted -- see
-- 20260905093000) -- this only ever returns the platform admin's own broadcast content
-- grouped down to one row per broadcast, never any school's actual communications or
-- per-recipient rows.
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
