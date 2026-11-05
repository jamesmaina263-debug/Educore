-- WP 5.4 + 5.5 (3/3): let the guardian opt-out appear only where bus alerts are actually live. Additive only.
--
-- Why: feature flags get switched on for many schools in bulk, but a school's alert mode stays 'off' until staff
-- set a test phone, send a test alert and choose live. Parents at a school that is off or only testing should not
-- see a "Bus alerts" panel. Parents cannot read bus_alert_settings (staff only), so this exposes ONE boolean,
-- nothing else (not the test phone, not the mode name).
--
-- * One new function. Returns true only when the caller's school has the flag on AND its mode is 'live'.
-- * Nothing existing is touched. Rollback: drop the function (the portal then simply stops showing the toggle).

create or replace function public.bus_alerts_live_for_my_school()
returns boolean
language sql
stable
security definer
set search_path to 'public'
as $$
  select coalesce(
    (select s.mode = 'live'
       from public.bus_alert_settings s
      where s.school_id = auth_school_id()
        and public.school_has_feature_flag(s.school_id, 'feature.transport.guardian_alerts')),
    false);
$$;
revoke all on function public.bus_alerts_live_for_my_school() from public, anon;
grant execute on function public.bus_alerts_live_for_my_school() to authenticated;
