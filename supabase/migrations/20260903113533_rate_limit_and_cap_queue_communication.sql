-- queue_communication() had no cap on recipients per call and no rate limit on how often a
-- sender can call it -- the actual cost surface for bulk SMS/WhatsApp/email (send-communication
-- just flushes what's already queued here, already batched at 100/call). A compromised or
-- malicious communication.write account could otherwise queue unbounded real-money sends.
-- Adds: (1) a 5,000-recipient cap per call -- generous for any real school-wide announcement,
-- well below anything that would look like abuse or accidentally flood notification_logs; (2) a
-- rate limit of 30 calls/hour per sender, reusing increment_and_check_rate_limit() the same way
-- initiate_mpesa_stk_request() and request-otp already do. Signature is unchanged (CREATE OR
-- REPLACE), so send-communication and every existing caller need no changes.
CREATE OR REPLACE FUNCTION public.queue_communication(
  p_recipients jsonb,
  p_template_id uuid DEFAULT NULL::uuid,
  p_body text DEFAULT NULL::text,
  p_channel text DEFAULT 'sms'::text,
  p_subject text DEFAULT NULL::text,
  p_category text DEFAULT NULL::text
)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
declare
  v_school_id uuid := auth_school_id();
  v_sender uuid;
  v_template_body text;
  v_template_category text;
  v_effective_category text;
  v_recipient jsonb;
  v_rendered text;
  v_recipient_school_user_id uuid;
  v_count integer := 0;
begin
  if not auth_has_permission('communication.write') then
    raise exception 'Not authorized to send communications.';
  end if;
  if p_template_id is null and p_body is null then
    raise exception 'Either a template or a message body is required.';
  end if;
  if p_channel not in ('sms','email','whatsapp','in_app') then
    raise exception 'channel must be sms, email, whatsapp, or in_app';
  end if;
  if jsonb_array_length(p_recipients) > 5000 then
    raise exception 'Too many recipients in a single request (max 5000). Split into smaller batches.';
  end if;

  select id into v_sender from school_users where auth_user_id = auth.uid();

  if not increment_and_check_rate_limit('queue-comm:' || coalesce(v_sender::text, auth.uid()::text), 30, 3600) then
    raise exception 'Too many communication requests in the last hour. Try again shortly.';
  end if;

  if p_template_id is not null then
    select body, category into v_template_body, v_template_category
      from communication_templates where id = p_template_id and school_id = v_school_id;
    if v_template_body is null then
      raise exception 'Template not found.';
    end if;
  end if;

  v_effective_category := coalesce(p_category, v_template_category);

  for v_recipient in select * from jsonb_array_elements(p_recipients) loop
    v_rendered := render_template(coalesce(v_template_body, p_body), coalesce(v_recipient->'values', '{}'::jsonb));
    v_recipient_school_user_id := nullif(v_recipient->>'school_user_id', '')::uuid;

    if p_channel = 'email' and nullif(v_recipient->>'email', '') is null then
      continue;
    end if;
    if p_channel in ('sms','whatsapp') and nullif(v_recipient->>'phone', '') is null then
      continue;
    end if;
    if p_channel = 'in_app' and v_recipient_school_user_id is null then
      continue;
    end if;

    if v_effective_category is not null and v_recipient_school_user_id is not null
       and not notification_allowed(v_recipient_school_user_id, v_effective_category, p_channel) then
      continue;
    end if;

    insert into notification_logs (
      school_id, student_id, recipient_phone, recipient_email, recipient_school_user_id, recipient_type,
      channel, template_id, subject, body, status, segments, sent_by
    )
    values (
      v_school_id,
      nullif(v_recipient->>'student_id', '')::uuid,
      nullif(v_recipient->>'phone', ''),
      nullif(v_recipient->>'email', ''),
      v_recipient_school_user_id,
      coalesce(v_recipient->>'recipient_type', 'guardian'),
      p_channel,
      p_template_id,
      p_subject,
      v_rendered,
      case when p_channel = 'in_app' then 'delivered' else 'queued' end,
      case when p_channel = 'sms' then greatest(1, ceil(length(v_rendered)::numeric / 160))::smallint else 1 end,
      v_sender
    );
    v_count := v_count + 1;
  end loop;

  return v_count;
end;
$function$;
