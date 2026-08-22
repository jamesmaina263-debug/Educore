-- Fresh-replay fix: the original version of this migration used `create or
-- replace function ... returns void`, but the function previously returned
-- boolean -- Postgres rejects changing a function's return type via CREATE
-- OR REPLACE, so this failed on any clean migration replay (new project /
-- supabase db reset). Production already has this function in its final
-- (boolean-returning, per the very next migration) state, so this drop is a
-- no-op there; it only matters for fresh projects replaying history from
-- scratch. Matches the same drop-then-create pattern the following
-- migration (fix_fee_threshold_alert_silent_failure) already uses for this
-- same function.
drop function if exists public.send_fee_threshold_alert(uuid);

create or replace function public.send_fee_threshold_alert(p_alert_id uuid)
returns void
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_alert record;
  v_school_name text;
  v_sender uuid;
begin
  select * into v_alert from public.fee_threshold_alerts where id = p_alert_id;
  if v_alert.id is null then
    raise exception 'Alert not found.';
  end if;
  if not (auth_is_super_admin() or (v_alert.school_id = auth_school_id() and auth_has_permission('finance.write'))) then
    raise exception 'Not authorized to send this alert.';
  end if;
  if v_alert.status not in ('draft', 'approved') then
    raise exception 'This alert has already been sent or dismissed.';
  end if;

  select id into v_sender from public.school_users where auth_user_id = auth.uid();
  select name into v_school_name from public.schools where id = v_alert.school_id;

  if not public.notification_allowed(v_alert.guardian_user_id, 'fee_threshold_alert', 'sms') then
    update public.fee_threshold_alerts
      set status = 'sent', approved_by = v_sender, approved_at = now(), sent_at = now()
      where id = p_alert_id;
    return;
  end if;

  insert into public.notification_logs (
    school_id, student_id, recipient_school_user_id, recipient_phone, recipient_type, channel, body,
    segments, sent_by, source_module
  )
  select
    v_alert.school_id, v_alert.student_id, v_alert.guardian_user_id, su.phone, 'guardian', 'sms',
    v_alert.draft_body, greatest(1, ceil(length(v_alert.draft_body)::numeric / 160))::smallint,
    v_sender, 'fee_threshold_alert'
  from public.school_users su where su.id = v_alert.guardian_user_id and su.phone is not null;

  if not found then
    insert into public.notification_logs (
      school_id, student_id, recipient_school_user_id, recipient_email, recipient_type, channel, subject, body,
      segments, sent_by, source_module
    )
    select
      v_alert.school_id, v_alert.student_id, v_alert.guardian_user_id, su.email, 'guardian', 'email',
      v_school_name || ' -- Fee Balance Reminder', v_alert.draft_body, 1, v_sender, 'fee_threshold_alert'
    from public.school_users su where su.id = v_alert.guardian_user_id and su.email is not null;
  end if;

  update public.fee_threshold_alerts
    set status = 'sent', approved_by = v_sender, approved_at = now(), sent_at = now()
    where id = p_alert_id;
end;
$$;
