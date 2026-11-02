-- Phase 1.4 fix: generate_fee_reminders() must REFUSE a caller with no role claim.
--
-- Found by the first real run of supabase/tests/scheduled_fee_reminders.sql. With no role claim
-- auth.role() is NULL, so v_is_cron was NULL, `if not v_is_cron` evaluated to NULL (false), and the
-- authorization check was skipped; the function then returned 0 instead of raising. No data was
-- exposed (anon cannot execute it, and the school filter matched no rows), but a missing check that
-- happens to be harmless is still a missing check. coalesce(..., false) makes the caller non-cron by
-- default, so the finance.write / school checks always run.
-- Only change vs the version in 20261101165200: the v_is_cron line. Flag is still off everywhere.

create or replace function public.generate_fee_reminders(p_force boolean default false)
returns integer
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_is_cron boolean := coalesce(auth.role() = 'service_role', false);
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
