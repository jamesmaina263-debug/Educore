-- Data integrity fix (Section 17: duplicate messages): send_fee_threshold_alert() read the
-- alert's status, did all its work (including the actual SMS/email INSERT into
-- notification_logs), and only updated status='sent' at the very end. Two concurrent calls for
-- the same alert_id -- a double-click before the UI disables the button, two browser tabs, a
-- client retry after a slow response -- could both pass the "not already sent/dismissed" check
-- before either commits, both insert a notification_logs row, and both send. Guardian gets the
-- same fee-balance SMS twice.
--
-- Fix: `for update` on the initial SELECT. This is a plain row lock, not a new status value or
-- schema change -- a second concurrent transaction for the same alert_id now blocks until the
-- first commits, then re-reads status as 'sent' and correctly hits the existing "already sent"
-- exception. No caller changes needed: approveAndSendAction already does
-- `if (error) return { error: error.message }`, which already surfaces a raised exception
-- exactly as it would have before.
create or replace function public.send_fee_threshold_alert(p_alert_id uuid)
 returns boolean
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare
  v_alert record;
  v_school_name text;
  v_sender uuid;
  v_rows integer;
begin
  select * into v_alert from public.fee_threshold_alerts where id = p_alert_id for update;
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
    return true;
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
  get diagnostics v_rows = row_count;

  if v_rows = 0 then
    insert into public.notification_logs (
      school_id, student_id, recipient_school_user_id, recipient_email, recipient_type, channel, subject, body,
      segments, sent_by, source_module
    )
    select
      v_alert.school_id, v_alert.student_id, v_alert.guardian_user_id, su.email, 'guardian', 'email',
      v_school_name || ' -- Fee Balance Reminder', v_alert.draft_body, 1, v_sender, 'fee_threshold_alert'
    from public.school_users su where su.id = v_alert.guardian_user_id and su.email is not null;
    get diagnostics v_rows = row_count;
  end if;

  if v_rows = 0 then
    update public.fee_threshold_alerts
      set status = 'dismissed', dismissed_by = v_sender, dismissed_at = now(),
          dismiss_reason = 'Could not send: guardian has no phone or email on file.'
      where id = p_alert_id;
    return false;
  end if;

  update public.fee_threshold_alerts
    set status = 'sent', approved_by = v_sender, approved_at = now(), sent_at = now()
    where id = p_alert_id;
  return true;
end;
$function$;
