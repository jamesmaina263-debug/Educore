create or replace function public.queue_admission_form_email(
  p_application_id uuid, p_subject text, p_body text,
  p_attachment_storage_path text default null, p_attachment_filename text default null
)
returns uuid
language plpgsql
security definer
set search_path to 'public'
as $function$
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
