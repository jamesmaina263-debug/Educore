-- Extends platform_notifications (see 20260830120956_platform_admin_notifications.sql) to
-- cover marketing_leads (lead-magnet form submissions), so the admin notification bell
-- fires for these the same way it already does for marketing_demo_requests.
--
-- Deliberately in-app notification only (kind: 'lead_magnet') -- no call to the
-- notify-platform-admin edge function / email dispatch here, unlike the demo-request
-- trigger. A lead-magnet download is a lower-intent, higher-volume signal than a demo
-- request; wiring the same per-submission email would be a separate, deliberate decision
-- (subject, cadence/digest vs. per-row, recipient) rather than an automatic extension of
-- this one. The in-app bell is what was actually asked for.

alter table public.platform_notifications
  drop constraint platform_notifications_kind_check;

alter table public.platform_notifications
  add constraint platform_notifications_kind_check
  check (kind in ('demo_request', 'lead_magnet'));

create or replace function public.notify_admin_new_lead()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $function$
begin
  insert into public.platform_notifications (kind, title, body, action_path, related_table, related_id)
  values (
    'lead_magnet',
    'New lead captured',
    new.email || ' downloaded ' || replace(new.resource, '_', ' '),
    '/admin/leads',
    'marketing_leads',
    new.id
  );

  return new;
end;
$function$;

drop trigger if exists trg_notify_admin_new_lead on public.marketing_leads;

create trigger trg_notify_admin_new_lead
  after insert on public.marketing_leads
  for each row execute function public.notify_admin_new_lead();
