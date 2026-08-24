-- ============================================================
-- Notification bell "Clear all" — the bell only ever grew (mark-as-read
-- existed but nothing removed a notification from the list), so it just
-- piled up indefinitely for active users. Adds a per-user dismiss, same
-- security-definer RPC pattern as mark_notification_read.
-- ============================================================

alter table public.notification_logs
  add column if not exists dismissed_at timestamptz;

-- Bulk-dismiss every one of the caller's own in-app notifications that
-- isn't already dismissed. Does not touch read_at or delete the row --
-- this only hides it from that user's bell; the underlying record (and
-- any audit trail depending on it, e.g. attendance-correction history)
-- is untouched. Scoped to the caller's own recipient_school_user_id only,
-- same as mark_notification_read.
create or replace function public.clear_my_notifications()
returns void
language plpgsql security definer set search_path to 'public'
as $$
declare
  v_me uuid := (select id from school_users where auth_user_id = auth.uid());
begin
  update notification_logs
  set dismissed_at = now()
  where recipient_school_user_id = v_me and dismissed_at is null;
end;
$$;

revoke all on function public.clear_my_notifications() from public, anon;
grant execute on function public.clear_my_notifications() to authenticated;
