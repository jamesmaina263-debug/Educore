
-- Renders {{placeholder}} tokens in a template body against a key/value jsonb map.
create or replace function render_template(p_body text, p_values jsonb) returns text
language plpgsql immutable as $$
declare
  v_result text := p_body;
  v_key text;
begin
  for v_key in select jsonb_object_keys(p_values) loop
    v_result := replace(v_result, '{{' || v_key || '}}', coalesce(p_values->>v_key, ''));
  end loop;
  return v_result;
end;
$$;

revoke execute on function render_template(text, jsonb) from public, anon;
grant execute on function render_template(text, jsonb) to authenticated;

-- Queues one notification per recipient. Rendering happens here (not client-side) so the stored
-- `body` is always what was actually queued, regardless of what the composer UI did. Actual
-- provider dispatch happens in the send-communication Edge Function afterward (Postgres can't make
-- outbound HTTP calls to Africa's Talking on its own) — this only ever leaves rows at status='queued'.
create or replace function queue_communication(
  p_recipients jsonb, -- [{"phone": "+254...", "student_id": "uuid-or-null", "recipient_type": "guardian|student|staff", "values": {...}}]
  p_template_id uuid default null,
  p_body text default null
) returns integer
language plpgsql security definer set search_path = public as $$
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

  if p_template_id is not null then
    select body into v_template_body from communication_templates where id = p_template_id and school_id = v_school_id;
    if v_template_body is null then
      raise exception 'Template not found.';
    end if;
  end if;

  select id into v_sender from school_users where auth_user_id = auth.uid();

  for v_recipient in select * from jsonb_array_elements(p_recipients) loop
    v_rendered := render_template(coalesce(v_template_body, p_body), coalesce(v_recipient->'values', '{}'::jsonb));
    insert into notification_logs (school_id, student_id, recipient_phone, recipient_type, template_id, body, segments, sent_by)
    values (
      v_school_id,
      nullif(v_recipient->>'student_id', '')::uuid,
      v_recipient->>'phone',
      coalesce(v_recipient->>'recipient_type', 'guardian'),
      p_template_id,
      v_rendered,
      greatest(1, ceil(length(v_rendered)::numeric / 160))::smallint,
      v_sender
    );
    v_count := v_count + 1;
  end loop;

  return v_count;
end;
$$;

revoke execute on function queue_communication(jsonb, uuid, text) from public, anon;
grant execute on function queue_communication(jsonb, uuid, text) to authenticated;

-- Automatic absence-alert rule (blueprint Part D): a student absent 3+ consecutive school days
-- queues an SMS to the primary guardian. Simplified from the blueprint's exact wording — "without a
-- guardian-acknowledged reason" implies a guardian-acknowledgment mechanism that doesn't exist
-- anywhere in the schema yet (no table for it, no portal flow to submit one); building that is its
-- own small feature, not something to invent silently inside a trigger. This fires on plain
-- 3-consecutive-absence, flagged here as a real simplification, not a silent gap. Fires exactly once
-- per streak (on the day the count crosses to 3, not again on day 4, 5, ...).
create or replace function check_consecutive_absences() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  v_streak integer;
  v_guardian_phone text;
  v_student_name text;
  v_school_name text;
  v_school_id uuid;
begin
  if new.status != 'absent' then
    return new;
  end if;

  -- Count consecutive absent days ending at (and including) this attendance_date, walking backward
  -- day by day through this student's attendance history.
  with recursive streak as (
    select attendance_date, 1 as n from student_attendance
    where student_id = new.student_id and attendance_date = new.attendance_date and status = 'absent'
    union all
    select sa.attendance_date, s.n + 1
    from student_attendance sa
    join streak s on sa.attendance_date = s.attendance_date - 1
    where sa.student_id = new.student_id and sa.status = 'absent'
  )
  select max(n) into v_streak from streak;

  if v_streak != 3 then
    return new; -- only fire the day the streak crosses 3, never re-fire on day 4+
  end if;

  select st.school_id, (st.first_name || ' ' || st.last_name), s.name
    into v_school_id, v_student_name, v_school_name
  from students st join schools s on s.id = st.school_id
  where st.id = new.student_id;

  select su.phone into v_guardian_phone
  from student_guardians sg
  join school_users su on su.id = sg.guardian_user_id
  where sg.student_id = new.student_id and sg.primary_contact = true
  limit 1;

  if v_guardian_phone is null then
    return new; -- no primary guardian phone on file; nothing to queue
  end if;

  insert into notification_logs (school_id, student_id, recipient_phone, recipient_type, body, segments, sent_by)
  values (
    v_school_id, new.student_id, v_guardian_phone, 'guardian',
    format('%s: %s has been absent for 3 consecutive school days. Please contact the school office.', v_school_name, v_student_name),
    1, null
  );

  return new;
end;
$$;

revoke execute on function check_consecutive_absences() from public, anon, authenticated;

create trigger student_attendance_absence_alert
  after insert or update on student_attendance
  for each row execute function check_consecutive_absences();
