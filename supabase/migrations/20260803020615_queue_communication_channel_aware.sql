create or replace function public.queue_communication(
  p_recipients jsonb,
  p_template_id uuid default null,
  p_body text default null,
  p_channel text default 'sms',
  p_subject text default null
)
returns integer
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_school_id uuid := auth_school_id();
  v_sender uuid;
  v_template_body text;
  v_recipient jsonb;
  v_rendered text;
  v_count integer := 0;
begin
  if not auth_has_permission('communication.write') then
    raise exception 'Not authorized to send communications.';
  end if;
  if p_template_id is null and p_body is null then
    raise exception 'Either a template or a message body is required.';
  end if;
  if p_channel not in ('sms','email','whatsapp') then
    raise exception 'channel must be sms, email, or whatsapp';
  end if;

  if p_template_id is not null then
    select body into v_template_body from communication_templates where id = p_template_id and school_id = v_school_id;
    if v_template_body is null then
      raise exception 'Template not found.';
    end if;
  end if;

  select id into v_sender from school_users where auth_user_id = auth.uid();

  for v_recipient in select * from jsonb_array_elements(p_recipients) loop
    v_rendered := render_template(coalesce(v_template_body, p_body), coalesce(v_recipient->'values', '{}'::jsonb));

    if p_channel = 'email' and nullif(v_recipient->>'email', '') is null then
      continue; -- skip recipients with no email on file rather than fail the whole batch
    end if;
    if p_channel in ('sms','whatsapp') and nullif(v_recipient->>'phone', '') is null then
      continue;
    end if;

    insert into notification_logs (
      school_id, student_id, recipient_phone, recipient_email, recipient_type,
      channel, template_id, subject, body, segments, sent_by
    )
    values (
      v_school_id,
      nullif(v_recipient->>'student_id', '')::uuid,
      nullif(v_recipient->>'phone', ''),
      nullif(v_recipient->>'email', ''),
      coalesce(v_recipient->>'recipient_type', 'guardian'),
      p_channel,
      p_template_id,
      p_subject,
      v_rendered,
      case when p_channel = 'sms' then greatest(1, ceil(length(v_rendered)::numeric / 160))::smallint else 1 end,
      v_sender
    );
    v_count := v_count + 1;
  end loop;

  return v_count;
end;
$$;
