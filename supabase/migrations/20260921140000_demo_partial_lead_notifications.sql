-- Admin notification bell for step-1 demo-form leads (marketing_demo_partial_leads, see
-- 20260921120000_marketing_demo_partial_leads.sql): when a visitor presses Continue on the
-- two-step demo form and their contact details are saved, platform staff get an in-app
-- notification, the same way marketing_demo_requests and marketing_leads already do.
--
-- Deliberately in-app only (kind: 'demo_partial_lead'), no email dispatch -- same reasoning as
-- 20260920093734_lead_magnet_admin_notifications.sql: a step-1 save is a lower-intent signal
-- than a submitted request, and a per-lead email would be a separate decision. The bell is what
-- was asked for.
--
-- INSERT only: the server action refreshes an existing open row with an UPDATE when a visitor
-- goes back and re-submits step 1, and that must not ring the bell again.
--
-- The notification insert is wrapped in an exception block on purpose. This trigger runs inside
-- the transaction that saves the lead, so an error here (e.g. a future change to
-- platform_notifications' constraints) would otherwise roll back the lead itself -- losing the
-- very contact this feature exists to capture -- just because the bell could not be updated.

alter table public.platform_notifications
  drop constraint if exists platform_notifications_kind_check;

alter table public.platform_notifications
  add constraint platform_notifications_kind_check
  check (kind in ('demo_request', 'lead_magnet', 'demo_partial_lead'));

create or replace function public.notify_admin_new_demo_partial_lead()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $function$
begin
  begin
    insert into public.platform_notifications (kind, title, body, action_path, related_table, related_id)
    values (
      'demo_partial_lead',
      'Demo request started',
      coalesce(new.school_name, new.name) || ' (' || new.name || ') entered their contact details but has not finished the form',
      '/admin/demo-requests',
      'marketing_demo_partial_leads',
      new.id
    );
  exception when others then
    raise warning 'notify_admin_new_demo_partial_lead: notification not written: %', sqlerrm;
  end;

  return new;
end;
$function$;

-- Trigger function, never a client RPC (new public-schema functions get PUBLIC EXECUTE by default).
revoke all on function public.notify_admin_new_demo_partial_lead() from public, anon, authenticated;

drop trigger if exists trg_notify_admin_new_demo_partial_lead on public.marketing_demo_partial_leads;

create trigger trg_notify_admin_new_demo_partial_lead
  after insert on public.marketing_demo_partial_leads
  for each row execute function public.notify_admin_new_demo_partial_lead();
