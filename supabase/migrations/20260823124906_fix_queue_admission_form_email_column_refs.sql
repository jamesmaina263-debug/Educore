-- Reconstructed from live schema introspection (Supabase project alzqlvfaftwegptfbfej).
-- Original SQL never committed to the repo. This migration's name suggests a fix for
-- ambiguous/incorrect column references in queue_admission_form_email() shortly after it was
-- first introduced (20260823124839_admission_form_template_infrastructure.sql, same day).
-- Re-applies the identical current live body; CREATE OR REPLACE makes this a no-op after the
-- other file runs, which is safe and keeps the migration history complete.

CREATE OR REPLACE FUNCTION public.queue_admission_form_email(
  p_application_id uuid,
  p_subject text,
  p_body text,
  p_attachment_storage_path text DEFAULT NULL::text,
  p_attachment_filename text DEFAULT NULL::text
)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_school_id uuid := auth_school_id();
  v_sender uuid;
  v_email text;
  v_log_id uuid;
begin
  if not auth_has_permission('admissions.write') then
    raise exception 'Not authorized.';
  end if;

  select su.email into v_email
  from public.applications app
  join public.school_users su on su.id = app.guardian_id
  where app.id = p_application_id and app.school_id = v_school_id;

  if not found or v_email is null then
    return null;
  end if;

  select id into v_sender from public.school_users where auth_user_id = auth.uid();

  insert into public.notification_logs (
    school_id, recipient_email, recipient_type, channel, subject, body, status, segments, sent_by,
    source_module, attachment_storage_path, attachment_filename
  ) values (
    v_school_id, v_email, 'guardian', 'email', p_subject, p_body, 'queued', 1, v_sender,
    'admissions', p_attachment_storage_path, p_attachment_filename
  ) returning id into v_log_id;

  return v_log_id;
end;
$function$;
