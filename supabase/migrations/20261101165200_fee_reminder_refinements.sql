-- Phase 1.4 refinements (1/2): smarter, safer fee reminders. Still dark (flag off for every school).
--
-- 1. Guardians can manage fee-threshold alerts: 'fee_threshold_alert' is added to the allowed
--    notification_preferences categories. This only WIDENS the check (existing rows stay valid).
--    send_fee_threshold_alert already consults notification_allowed(..., 'fee_threshold_alert', 'sms'),
--    so the preference starts working with no change to it. It is a separate category from
--    'fee_reminder' and from every other category: turning it off affects nothing else.
-- 2. Schools choose a saved template (communication_templates, category fee_reminder) per schedule;
--    EduCore's default text is used when none is chosen or the chosen one becomes invalid.
--    Placeholders are validated because render_template leaves unknown {{x}} in the SMS untouched.
-- 3. Balance is re-validated at send time against invoices, approved discounts, allocated payments AND
--    payments received but not yet allocated. Cleared => the reminder is CANCELLED, not sent.
--    If the amount changed since drafting, nothing is sent: the draft is refreshed for re-approval.
-- 4. De-duplication is tracked per guardian + student + notification type + threshold, and a
--    notification whose delivery FAILED does not count as sent (re-draftable, capped at 3 failures
--    per window).
-- Replaces only objects created in #747 (generate_fee_reminders, send_fee_reminder,
-- set_fee_reminder_schedule); they have zero rows and no caller while the flag is off.

-- 1. Preference category.
alter table public.notification_preferences drop constraint if exists notification_preferences_category_check;
alter table public.notification_preferences add constraint notification_preferences_category_check
  check (category = any (array[
    'fee_reminder', 'absence_alert', 'result_published', 'announcement', 'other', 'gate_attendance', 'fee_threshold_alert'
  ]::text[]));

-- 2. Columns (all additive).
alter table public.fee_reminder_schedules
  add column if not exists template_id uuid references public.communication_templates(id) on delete set null;

alter table public.fee_reminders
  add column if not exists notification_type text not null default 'fee_reminder',
  add column if not exists threshold_at_generation numeric(12,2),
  add column if not exists template_id uuid references public.communication_templates(id) on delete set null,
  add column if not exists template_body text,
  add column if not exists edited boolean not null default false,
  add column if not exists notification_log_id uuid references public.notification_logs(id) on delete set null,
  add column if not exists cancelled_at timestamptz,
  add column if not exists cancel_reason text;

alter table public.fee_reminders drop constraint if exists fee_reminders_status_check;
alter table public.fee_reminders add constraint fee_reminders_status_check
  check (status in ('draft', 'sent', 'dismissed', 'cancelled'));
alter table public.fee_reminders drop constraint if exists fee_reminders_notification_type_check;
alter table public.fee_reminders add constraint fee_reminders_notification_type_check
  check (notification_type in ('fee_reminder'));

create index if not exists fee_reminders_dedupe_idx
  on public.fee_reminders (guardian_user_id, student_id, notification_type, threshold_at_generation, status);

comment on column public.fee_reminders.status is
  'draft = awaiting a finance user; sent = approved and queued (delivery state lives in notification_logs via notification_log_id); dismissed = a person discarded it; cancelled = the system withheld it (opt-out, no phone, balance cleared).';

-- 3. Helpers (internal only: callable by the definer functions below, not by clients).
create or replace function public.fee_reminder_default_template()
returns text language sql immutable set search_path to 'public' as $$
  select 'Dear {{guardian_name}}, this is a reminder that {{student_name}}''s fee balance at {{school_name}} is KES {{balance}}. Kindly clear it at your earliest convenience. If you have already paid, please ignore this message. Thank you.'::text
$$;

-- Returns null when the template is usable, otherwise a plain-language reason.
create or replace function public.fee_reminder_template_problem(p_body text)
returns text language plpgsql immutable set search_path to 'public' as $$
declare
  v_key text;
begin
  if p_body is null or length(btrim(p_body)) = 0 then
    return 'The template message is empty.';
  end if;
  if length(p_body) > 1000 then
    return 'The template is longer than 1000 characters.';
  end if;
  for v_key in select (regexp_matches(p_body, '\{\{([^}]*)\}\}', 'g'))[1] loop
    if v_key not in ('guardian_name', 'student_name', 'school_name', 'balance') then
      return 'The template uses {{' || v_key || '}}, which is not supported. Use {{guardian_name}}, {{student_name}}, {{school_name}} and {{balance}}.';
    end if;
  end loop;
  return null;
end;
$$;

create or replace function public.fee_reminder_render(p_template text, p_guardian text, p_student text, p_school text, p_balance numeric)
returns text language sql immutable set search_path to 'public' as $$
  select public.render_template(p_template, jsonb_build_object(
    'guardian_name', coalesce(nullif(btrim(p_guardian), ''), 'Parent/Guardian'),
    'student_name', coalesce(p_student, ''),
    'school_name', coalesce(p_school, ''),
    'balance', to_char(greatest(p_balance, 0), 'FM999,999,999')
  ))
$$;

-- What is genuinely still owed: the fee balance (invoices - approved discounts - allocated payments)
-- minus money already received for this learner that has not been allocated yet.
create or replace function public.fee_reminder_outstanding(p_student_id uuid)
returns numeric language sql stable security definer set search_path to 'public' as $$
  select coalesce((select vb.balance from public.v_student_balances vb where vb.student_id = p_student_id), 0)
       - coalesce((select sum(p.amount) from public.payments p where p.student_id = p_student_id and p.status = 'unallocated'), 0)
$$;

revoke all on function public.fee_reminder_default_template() from public, anon, authenticated;
revoke all on function public.fee_reminder_template_problem(text) from public, anon, authenticated;
revoke all on function public.fee_reminder_render(text, text, text, text, numeric) from public, anon, authenticated;
revoke all on function public.fee_reminder_outstanding(uuid) from public, anon, authenticated;

-- 4. Schedule save now carries the chosen template.
drop function if exists public.set_fee_reminder_schedule(boolean, text, smallint, smallint, text, numeric, smallint);
create or replace function public.set_fee_reminder_schedule(
  p_enabled boolean,
  p_frequency text,
  p_run_weekday smallint,
  p_run_day_of_month smallint,
  p_channel text,
  p_min_balance numeric,
  p_min_days_between smallint,
  p_template_id uuid default null
) returns void
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_school uuid := auth_school_id();
  v_tpl record;
  v_problem text;
begin
  if v_school is null or not auth_has_permission('finance.write') then
    raise exception 'Not authorized to change the reminder schedule.' using errcode = '42501';
  end if;
  if not public.school_has_feature_flag(v_school, 'feature.finance.scheduled_reminders') then
    raise exception 'Scheduled reminders are not enabled for this school.' using errcode = '55000';
  end if;
  if p_frequency not in ('weekly', 'fortnightly', 'monthly')
     or p_channel not in ('sms', 'whatsapp')
     or p_run_weekday not between 0 and 6
     or p_run_day_of_month not between 1 and 28
     or p_min_balance is null or p_min_balance <= 0
     or p_min_days_between not between 1 and 90 then
    raise exception 'Invalid reminder schedule settings.' using errcode = '22023';
  end if;

  if p_template_id is not null then
    select t.id, t.body, t.category, t.channel into v_tpl
      from public.communication_templates t
     where t.id = p_template_id and t.school_id = v_school;
    if v_tpl.id is null or v_tpl.category <> 'fee_reminder' then
      raise exception 'Choose one of your fee reminder templates.' using errcode = '22023';
    end if;
    if v_tpl.channel is not null and v_tpl.channel <> p_channel then
      raise exception 'That template is for a different channel. Choose a % template.', p_channel using errcode = '22023';
    end if;
    v_problem := public.fee_reminder_template_problem(v_tpl.body);
    if v_problem is not null then
      raise exception '%', v_problem using errcode = '22023';
    end if;
  end if;

  insert into public.fee_reminder_schedules as s (
    school_id, enabled, frequency, run_weekday, run_day_of_month, channel, min_balance, min_days_between, template_id
  ) values (
    v_school, coalesce(p_enabled, false), p_frequency, p_run_weekday, p_run_day_of_month, p_channel, p_min_balance, p_min_days_between, p_template_id
  )
  on conflict (school_id) do update set
    enabled = excluded.enabled,
    frequency = excluded.frequency,
    run_weekday = excluded.run_weekday,
    run_day_of_month = excluded.run_day_of_month,
    channel = excluded.channel,
    min_balance = excluded.min_balance,
    min_days_between = excluded.min_days_between,
    template_id = excluded.template_id,
    updated_at = now();
end;
$$;
revoke all on function public.set_fee_reminder_schedule(boolean, text, smallint, smallint, text, numeric, smallint, uuid) from public, anon;
grant execute on function public.set_fee_reminder_schedule(boolean, text, smallint, smallint, text, numeric, smallint, uuid) to authenticated;

-- 5. Draft generator (drafts only; a person still approves every message).
create or replace function public.generate_fee_reminders(p_force boolean default false)
returns integer
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_is_cron boolean := (auth.role() = 'service_role');
  v_caller_school uuid;
  v_today date := (now() at time zone 'Africa/Nairobi')::date;
  v_dow integer := extract(dow from (now() at time zone 'Africa/Nairobi'))::integer;
  v_dom integer := extract(day from (now() at time zone 'Africa/Nairobi'))::integer;
  v_sched record;
  v_due boolean;
  v_rec record;
  v_tpl_id uuid;
  v_tpl_body text;
  v_total integer := 0;
begin
  if not v_is_cron then
    v_caller_school := auth_school_id();
    if v_caller_school is null or not auth_has_permission('finance.write') then
      raise exception 'Not authorized to draft fee reminders.' using errcode = '42501';
    end if;
  end if;

  for v_sched in
    select s.*, sc.name as school_name
      from public.fee_reminder_schedules s
      join public.schools sc on sc.id = s.school_id
     where (v_is_cron and s.enabled)
        or (not v_is_cron and s.school_id = v_caller_school)
  loop
    if not public.school_has_feature_flag(v_sched.school_id, 'feature.finance.scheduled_reminders') then
      continue;
    end if;

    if v_is_cron then
      v_due := v_sched.last_generated_on is distinct from v_today and case v_sched.frequency
        when 'weekly' then v_dow = v_sched.run_weekday
          and (v_sched.last_generated_on is null or v_today - v_sched.last_generated_on >= 6)
        when 'fortnightly' then v_dow = v_sched.run_weekday
          and (v_sched.last_generated_on is null or v_today - v_sched.last_generated_on >= 13)
        when 'monthly' then v_dom = v_sched.run_day_of_month
          and (v_sched.last_generated_on is null or v_today - v_sched.last_generated_on >= 25)
        else false end;
      if not v_due then
        continue;
      end if;
    end if;

    -- Withdraw pending drafts that no longer have anything owing, so nobody is chased for a paid balance.
    update public.fee_reminders fr
       set status = 'cancelled', cancelled_at = now(),
           cancel_reason = 'Cancelled: the balance was cleared or a payment was received after this draft was made.'
     where fr.school_id = v_sched.school_id and fr.status = 'draft'
       and public.fee_reminder_outstanding(fr.student_id) < v_sched.min_balance;

    -- School template when valid, otherwise EduCore's default.
    v_tpl_id := null;
    v_tpl_body := public.fee_reminder_default_template();
    if v_sched.template_id is not null then
      select t.id, t.body into v_tpl_id, v_tpl_body
        from public.communication_templates t
       where t.id = v_sched.template_id and t.school_id = v_sched.school_id and t.category = 'fee_reminder'
         and (t.channel is null or t.channel = v_sched.channel)
         and public.fee_reminder_template_problem(t.body) is null;
      if v_tpl_id is null then
        v_tpl_body := public.fee_reminder_default_template();
      end if;
    end if;

    for v_rec in
      select vb.student_id, o.outstanding,
             (st.first_name || ' ' || st.last_name) as student_name,
             sg.guardian_user_id, su.full_name as guardian_name
        from public.v_student_balances vb
        join public.students st on st.id = vb.student_id
        join public.student_guardians sg on sg.student_id = st.id and sg.primary_contact = true
        join public.school_users su on su.id = sg.guardian_user_id
        cross join lateral (select public.fee_reminder_outstanding(vb.student_id) as outstanding) o
       where vb.school_id = v_sched.school_id
         and st.status = 'active'
         and o.outstanding >= v_sched.min_balance
         and su.phone is not null
         -- one pending draft per learner
         and not exists (
           select 1 from public.fee_reminders fr where fr.student_id = vb.student_id and fr.status = 'draft')
         -- same guardian + learner + type + threshold already reminded inside the gap (failed deliveries do not count)
         and not exists (
           select 1 from public.fee_reminders fr
             left join public.notification_logs nl on nl.id = fr.notification_log_id
            where fr.student_id = vb.student_id and fr.guardian_user_id = sg.guardian_user_id
              and fr.notification_type = 'fee_reminder'
              and fr.threshold_at_generation is not distinct from v_sched.min_balance
              and fr.status = 'sent'
              and fr.sent_at > now() - make_interval(days => v_sched.min_days_between)
              and coalesce(nl.status, 'sent') <> 'failed')
         -- retry safeguard: stop after 3 failed deliveries inside the gap
         and (
           select count(*) from public.fee_reminders fr
             join public.notification_logs nl on nl.id = fr.notification_log_id
            where fr.student_id = vb.student_id and fr.guardian_user_id = sg.guardian_user_id
              and fr.notification_type = 'fee_reminder'
              and fr.threshold_at_generation is not distinct from v_sched.min_balance
              and fr.status = 'sent'
              and fr.sent_at > now() - make_interval(days => v_sched.min_days_between)
              and nl.status = 'failed') < 3
         -- do not double-message: a fee-threshold alert to the same guardian about the same learner
         and not exists (
           select 1 from public.notification_logs nl
            where nl.source_module = 'fee_threshold_alert'
              and nl.student_id = vb.student_id and nl.recipient_school_user_id = sg.guardian_user_id
              and nl.created_at > now() - make_interval(days => v_sched.min_days_between)
              and nl.status <> 'failed')
         and not exists (
           select 1 from public.fee_threshold_alerts fta
            where fta.student_id = vb.student_id and fta.status in ('draft', 'approved'))
         -- a payment (e.g. an M-Pesa push) started in the last 30 minutes: do not chase mid-payment
         and not exists (
           select 1 from public.payments pp
            where pp.student_id = vb.student_id and pp.status = 'pending'
              and pp.created_at > now() - interval '30 minutes')
    loop
      -- Guardian opted out of fee reminders on this channel: no draft at all.
      if not public.notification_allowed(v_rec.guardian_user_id, 'fee_reminder', v_sched.channel) then
        continue;
      end if;

      insert into public.fee_reminders (
        school_id, student_id, guardian_user_id, channel, balance_at_generation, threshold_at_generation,
        draft_body, template_id, template_body, run_on, trigger_type
      ) values (
        v_sched.school_id, v_rec.student_id, v_rec.guardian_user_id, v_sched.channel, v_rec.outstanding, v_sched.min_balance,
        public.fee_reminder_render(v_tpl_body, v_rec.guardian_name, v_rec.student_name, v_sched.school_name, v_rec.outstanding),
        v_tpl_id, v_tpl_body, v_today, case when v_is_cron then 'scheduled' else 'manual' end
      )
      on conflict do nothing;
      if found then
        v_total := v_total + 1;
      end if;
    end loop;

    if v_is_cron then
      update public.fee_reminder_schedules set last_generated_on = v_today where school_id = v_sched.school_id;
    end if;
  end loop;

  return v_total;
end;
$$;
revoke all on function public.generate_fee_reminders(boolean) from public, anon;
grant execute on function public.generate_fee_reminders(boolean) to authenticated;

-- 6. Editing a draft marks it as hand-edited (so it is never silently re-rendered over).
create or replace function public.update_fee_reminder_draft(p_id uuid, p_body text)
returns void
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_row record;
begin
  select * into v_row from public.fee_reminders where id = p_id;
  if v_row.id is null then
    raise exception 'Reminder not found.' using errcode = 'P0002';
  end if;
  if not (v_row.school_id = auth_school_id() and auth_has_permission('finance.write')) then
    raise exception 'Not authorized.' using errcode = '42501';
  end if;
  if not public.school_has_feature_flag(v_row.school_id, 'feature.finance.scheduled_reminders') then
    raise exception 'Scheduled reminders are not enabled for this school.' using errcode = '55000';
  end if;
  if v_row.status <> 'draft' then
    raise exception 'This reminder has already been sent, dismissed or cancelled.' using errcode = '55000';
  end if;
  if p_body is null or length(btrim(p_body)) = 0 or length(p_body) > 1000 then
    raise exception 'Message must be 1 to 1000 characters.' using errcode = '22023';
  end if;
  update public.fee_reminders
     set draft_body = btrim(p_body), edited = (edited or btrim(p_body) <> draft_body)
   where id = p_id;
end;
$$;
revoke all on function public.update_fee_reminder_draft(uuid, text) from public, anon;
grant execute on function public.update_fee_reminder_draft(uuid, text) to authenticated;

-- 7. Refresh a draft from its template with the CURRENT balance (discards hand edits).
--    Returns 'refreshed', or 'cancelled' when nothing is owing any more.
create or replace function public.refresh_fee_reminder(p_id uuid)
returns text
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_row record;
  v_min numeric;
  v_out numeric;
  v_guardian text;
  v_student text;
  v_school text;
begin
  select * into v_row from public.fee_reminders where id = p_id for update;
  if v_row.id is null then
    raise exception 'Reminder not found.' using errcode = 'P0002';
  end if;
  if not (v_row.school_id = auth_school_id() and auth_has_permission('finance.write')) then
    raise exception 'Not authorized.' using errcode = '42501';
  end if;
  if not public.school_has_feature_flag(v_row.school_id, 'feature.finance.scheduled_reminders') then
    raise exception 'Scheduled reminders are not enabled for this school.' using errcode = '55000';
  end if;
  if v_row.status <> 'draft' then
    raise exception 'This reminder has already been sent, dismissed or cancelled.' using errcode = '55000';
  end if;

  select min_balance into v_min from public.fee_reminder_schedules where school_id = v_row.school_id;
  v_out := public.fee_reminder_outstanding(v_row.student_id);
  if v_out < coalesce(v_min, 1) then
    update public.fee_reminders
       set status = 'cancelled', cancelled_at = now(),
           cancel_reason = 'Cancelled: the balance was cleared or a payment was received after this draft was made.'
     where id = p_id;
    return 'cancelled';
  end if;

  select su.full_name into v_guardian from public.school_users su where su.id = v_row.guardian_user_id;
  select st.first_name || ' ' || st.last_name into v_student from public.students st where st.id = v_row.student_id;
  select sc.name into v_school from public.schools sc where sc.id = v_row.school_id;

  update public.fee_reminders
     set draft_body = public.fee_reminder_render(
           coalesce(template_body, public.fee_reminder_default_template()), v_guardian, v_student, v_school, v_out),
         balance_at_generation = v_out,
         edited = false
   where id = p_id;
  return 'refreshed';
end;
$$;
revoke all on function public.refresh_fee_reminder(uuid) from public, anon;
grant execute on function public.refresh_fee_reminder(uuid) to authenticated;

-- 8. Approve and queue one reminder, re-validating everything at the moment of sending.
--    Returns: 'sent' | 'cancelled' (withheld, with a reason) | 'refreshed' (amount changed, draft
--    updated, needs a fresh approval) | 'stale' (amount changed but the draft was hand-edited) |
--    'hold' (a payment is in progress; draft kept, try again shortly).
drop function if exists public.send_fee_reminder(uuid);
create or replace function public.send_fee_reminder(p_id uuid)
returns text
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_row record;
  v_me uuid;
  v_phone text;
  v_min numeric;
  v_balance numeric;
  v_out numeric;
  v_reason text;
  v_guardian text;
  v_student text;
  v_school text;
  v_log uuid;
begin
  select * into v_row from public.fee_reminders where id = p_id for update;
  if v_row.id is null then
    raise exception 'Reminder not found.' using errcode = 'P0002';
  end if;
  if not (v_row.school_id = auth_school_id() and auth_has_permission('finance.write')) then
    raise exception 'Not authorized to send this reminder.' using errcode = '42501';
  end if;
  if not public.school_has_feature_flag(v_row.school_id, 'feature.finance.scheduled_reminders') then
    raise exception 'Scheduled reminders are not enabled for this school.' using errcode = '55000';
  end if;
  if v_row.status <> 'draft' then
    raise exception 'This reminder has already been sent, dismissed or cancelled.' using errcode = '55000';
  end if;

  select id into v_me from public.school_users where auth_user_id = auth.uid();
  select phone, full_name into v_phone, v_guardian from public.school_users where id = v_row.guardian_user_id;
  select min_balance into v_min from public.fee_reminder_schedules where school_id = v_row.school_id;
  v_min := coalesce(v_min, 1);
  v_balance := coalesce((select vb.balance from public.v_student_balances vb where vb.student_id = v_row.student_id), 0);
  v_out := public.fee_reminder_outstanding(v_row.student_id);

  if not public.notification_allowed(v_row.guardian_user_id, 'fee_reminder', v_row.channel) then
    v_reason := 'Not sent: the guardian has opted out of fee reminders on this channel.';
  elsif v_phone is null then
    v_reason := 'Not sent: the guardian has no phone number on file.';
  elsif v_out < v_min then
    if v_balance >= v_min then
      v_reason := 'Not sent: a payment was received and is awaiting allocation, so nothing further is due.';
    elsif v_out <= 0 then
      v_reason := 'Not sent: the balance has been cleared.';
    else
      v_reason := 'Not sent: the balance is now below the reminder threshold.';
    end if;
  end if;

  if v_reason is not null then
    update public.fee_reminders
       set status = 'cancelled', cancelled_at = now(), cancel_reason = v_reason
     where id = p_id;
    return 'cancelled';
  end if;

  -- A payment started in the last 30 minutes may be about to clear this balance: keep the draft, send nothing.
  if exists (
    select 1 from public.payments pp
     where pp.student_id = v_row.student_id and pp.status = 'pending' and pp.created_at > now() - interval '30 minutes'
  ) then
    return 'hold';
  end if;

  -- The amount in the message must be the amount owed right now.
  if v_out is distinct from v_row.balance_at_generation then
    if v_row.edited then
      return 'stale';
    end if;
    select st.first_name || ' ' || st.last_name into v_student from public.students st where st.id = v_row.student_id;
    select sc.name into v_school from public.schools sc where sc.id = v_row.school_id;
    update public.fee_reminders
       set draft_body = public.fee_reminder_render(
             coalesce(template_body, public.fee_reminder_default_template()), v_guardian, v_student, v_school, v_out),
           balance_at_generation = v_out
     where id = p_id;
    return 'refreshed';
  end if;

  insert into public.notification_logs (
    school_id, student_id, recipient_school_user_id, recipient_phone, recipient_type, channel, body,
    segments, sent_by, source_module
  ) values (
    v_row.school_id, v_row.student_id, v_row.guardian_user_id, v_phone, 'guardian', v_row.channel,
    v_row.draft_body, greatest(1, ceil(length(v_row.draft_body)::numeric / 160))::smallint, v_me, 'fee_reminder'
  ) returning id into v_log;

  update public.fee_reminders
     set status = 'sent', approved_by = v_me, approved_at = now(), sent_at = now(), notification_log_id = v_log
   where id = p_id;
  return 'sent';
end;
$$;
revoke all on function public.send_fee_reminder(uuid) from public, anon;
grant execute on function public.send_fee_reminder(uuid) to authenticated;

-- 9. Delivery state for the review screen (notification_logs may not be readable by finance roles).
create or replace function public.fee_reminder_delivery_statuses()
returns table (reminder_id uuid, delivery_status text)
language plpgsql
stable
security definer
set search_path to 'public'
as $$
declare
  v_school uuid := auth_school_id();
begin
  if v_school is null or not auth_has_permission('finance.write') then
    raise exception 'Not authorized.' using errcode = '42501';
  end if;
  return query
    select fr.id, nl.status
      from public.fee_reminders fr
      join public.notification_logs nl on nl.id = fr.notification_log_id
     where fr.school_id = v_school;
end;
$$;
revoke all on function public.fee_reminder_delivery_statuses() from public, anon;
grant execute on function public.fee_reminder_delivery_statuses() to authenticated;
