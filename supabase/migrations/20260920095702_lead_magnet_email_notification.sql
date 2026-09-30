-- Extends notify_admin_new_lead() (20260920093734_lead_magnet_admin_notifications.sql) to also
-- call notify-platform-admin for a real email, mirroring notify_admin_new_demo_request() exactly.
-- The edge function itself was extended in the same session with a 'lead_magnet' branch that
-- emails PLATFORM_ADMIN_EMAIL with the visitor's email/resource/source_page.

create or replace function public.notify_admin_new_lead()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_webhook_secret text;
  v_project_url text := 'https://alzqlvfaftwegptfbfej.supabase.co';
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

  select decrypted_secret into v_webhook_secret
    from vault.decrypted_secrets
    where name = 'platform_notification_webhook_secret';

  perform net.http_post(
    url := v_project_url || '/functions/v1/notify-platform-admin',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-webhook-secret', coalesce(v_webhook_secret, '')
    ),
    body := jsonb_build_object(
      'kind', 'lead_magnet',
      'email', new.email,
      'resource', new.resource,
      'source_page', new.source_page,
      'lead_id', new.id
    )
  );

  return new;
end;
$function$;
