-- WP 5.4 + 5.5 (2/3): cancel bus alerts that could not be sent immediately. Additive only; ships dark.
--
-- Why: bus alerts are queued as notification_logs rows and sent right away by the app. The scheduled sweep
-- that also sends queued rows runs only once a day, so an alert that failed to send immediately would
-- otherwise go out hours later or the next morning ("the bus is 20 minutes late", received tomorrow). The app
-- calls this function when the immediate send fails, so a stale alert is marked failed and never sent.
--
-- * One new function. It only touches rows of the caller's own school that are still 'queued' AND were queued
--   by the bus alert functions (source_module = 'bus_alert'). It never touches any other module's messages.
-- * Needs transport.write and the feature.transport.guardian_alerts flag, like the other bus alert functions.
-- * Nothing existing is touched (no table, policy, trigger or function change). bus_alerts keeps its record of
--   what was queued; the notification_logs row records that it was cancelled and why.
-- Rollback: nothing depends on it; drop the function or leave the flag off.

create or replace function public.cancel_unsent_bus_alerts()
returns integer
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_school uuid := auth_school_id();
  v_n integer;
begin
  if v_school is null or not auth_has_permission('transport.write') then
    raise exception 'Not authorized to cancel bus alerts.' using errcode = '42501';
  end if;
  if not public.school_has_feature_flag(v_school, 'feature.transport.guardian_alerts') then
    raise exception 'Guardian bus alerts are not enabled for this school.' using errcode = '55000';
  end if;
  update public.notification_logs
     set status = 'failed',
         provider_response = 'Cancelled: bus alerts are time-sensitive and could not be sent immediately, so this was not sent late.',
         updated_at = now()
   where school_id = v_school
     and source_module = 'bus_alert'
     and status = 'queued';
  get diagnostics v_n = row_count;
  return v_n;
end;
$$;
revoke all on function public.cancel_unsent_bus_alerts() from public, anon;
grant execute on function public.cancel_unsent_bus_alerts() to authenticated;
