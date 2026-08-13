-- Rectify list item 5: let the Nurse notify a guardian about a student's health status,
-- reusing the existing Communication pipeline (queue_communication -> notification_logs ->
-- send-communication Edge Function) rather than building a second one.
--
-- The one real gap found while wiring this up: queue_communication() and the
-- send-communication Edge Function both require communication.write, which is only granted
-- to Bursar/Deputy Principal/Principal/School Owner -- NOT the Nurse role. Granting the Nurse
-- full communication.write would also open the entire Communication compose page (bulk
-- announcements, fee reminders, arbitrary broadcasts) to her, which is far broader than "notify
-- a guardian about their own child's health status". So this adds a narrow, health-scoped queue
-- path (queue_health_alert, gated on health.write) and a matching narrow dispatch path in the
-- Edge Function (see supabase/functions/send-communication/index.ts), rather than widening
-- communication.write.

alter table public.notification_logs add column source_module text;
comment on column public.notification_logs.source_module is
  'Which module queued this message, when it did not come from the Communication compose page itself -- currently only ''health''. Null for anything sent via the normal Communication flow. Also used by the Edge Function to scope what a health.write-only caller (the Nurse) is allowed to dispatch: only her own health-sourced queued rows, never the whole school''s pending queue.';

create or replace function public.queue_health_alert(
  p_student_id uuid,
  p_guardian_user_ids uuid[],
  p_body text
)
returns integer
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_school_id uuid := auth_school_id();
  v_sender uuid;
  v_guardian record;
  v_count integer := 0;
begin
  if not auth_has_permission('health.write') then
    raise exception 'insufficient permissions: health.write required';
  end if;

  if not exists (select 1 from public.students where id = p_student_id and school_id = v_school_id) then
    raise exception 'student not found in your school';
  end if;

  if p_body is null or length(trim(p_body)) = 0 then
    raise exception 'message body is required';
  end if;

  select id into v_sender from public.school_users where auth_user_id = auth.uid();

  -- Only guardians actually linked to this student can be messaged this way -- p_guardian_user_ids
  -- is a hint from the client (which boxes the Nurse checked), not itself the authorization; the
  -- join to student_guardians is what enforces it can't be used to message an arbitrary
  -- school_users row.
  for v_guardian in
    select su.id, su.phone
    from public.student_guardians sg
    join public.school_users su on su.id = sg.guardian_user_id
    where sg.student_id = p_student_id
      and su.id = any(p_guardian_user_ids)
      and su.phone is not null
  loop
    insert into public.notification_logs (
      school_id, student_id, recipient_phone, recipient_type, channel, body, segments, sent_by, source_module
    ) values (
      v_school_id, p_student_id, v_guardian.phone, 'guardian', 'sms', p_body,
      greatest(1, ceil(length(p_body)::numeric / 160))::smallint, v_sender, 'health'
    );
    v_count := v_count + 1;
  end loop;

  return v_count;
end;
$$;
