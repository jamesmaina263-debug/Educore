-- Phase 1.4 (1/2): scheduled fee reminders, draft-and-approve. Additive only; ships dark.
--
-- * New flag feature.finance.scheduled_reminders (catalog entry, enabled for nobody).
-- * New tables: fee_reminder_schedules (per-school cadence, off by default) and fee_reminders
--   (one draft per learner per run). RLS on, read for finance.write of own school, NO direct
--   write policies: every change goes through the functions below.
-- * Nothing is ever sent by a schedule. generate_fee_reminders() only writes drafts; a finance
--   user must approve each one (send_fee_reminder), which queues it into notification_logs
--   exactly like send_fee_threshold_alert does. Opt-outs (notification_preferences, category
--   fee_reminder, per channel) are honoured at draft time AND again at send time.
-- * Existing objects (fee_threshold_alerts, check_fee_thresholds, the school-comms cron) are
--   not touched. Learners with a pending/recent fee-threshold alert are skipped so a family is
--   not messaged twice.
-- Rollback: switch the flag off (functions refuse); nothing else depends on these objects.

-- 1. Flag catalog entry (visible in admin, enabled for nobody).
insert into public.platform_feature_flags (key, label, description)
select 'feature.finance.scheduled_reminders',
       'Scheduled fee reminders',
       'Drafts fee-arrears reminders on a per-school schedule for a finance user to review and approve. Nothing is sent automatically. Off by default.'
where not exists (
  select 1 from public.platform_feature_flags where lower(key) = 'feature.finance.scheduled_reminders'
);

-- 2. Per-school schedule.
create table if not exists public.fee_reminder_schedules (
  school_id uuid primary key references public.schools(id) on delete cascade,
  enabled boolean not null default false,
  frequency text not null default 'weekly' check (frequency in ('weekly', 'fortnightly', 'monthly')),
  run_weekday smallint not null default 1 check (run_weekday between 0 and 6),
  run_day_of_month smallint not null default 1 check (run_day_of_month between 1 and 28),
  channel text not null default 'sms' check (channel in ('sms', 'whatsapp')),
  min_balance numeric(12,2) not null default 1 check (min_balance > 0),
  min_days_between smallint not null default 14 check (min_days_between between 1 and 90),
  last_generated_on date,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
comment on table public.fee_reminder_schedules is
  'Per-school cadence for scheduled fee reminder DRAFTS. run_weekday uses 0=Sunday..6=Saturday (Africa/Nairobi date). Written only by set_fee_reminder_schedule() / generate_fee_reminders().';
alter table public.fee_reminder_schedules enable row level security;
drop policy if exists fee_reminder_schedules_select on public.fee_reminder_schedules;
create policy fee_reminder_schedules_select on public.fee_reminder_schedules for select
  using (auth_is_super_admin() or (school_id = auth_school_id() and auth_has_permission('finance.write')));

-- 3. Reminder drafts.
create table if not exists public.fee_reminders (
  id uuid primary key default gen_random_uuid(),
  school_id uuid not null references public.schools(id) on delete cascade,
  student_id uuid not null references public.students(id) on delete cascade,
  guardian_user_id uuid not null references public.school_users(id) on delete cascade,
  channel text not null check (channel in ('sms', 'whatsapp')),
  balance_at_generation numeric(12,2) not null,
  draft_body text not null,
  status text not null default 'draft' check (status in ('draft', 'sent', 'dismissed')),
  run_on date not null,
  trigger_type text not null check (trigger_type in ('scheduled', 'manual')),
  generated_at timestamptz not null default now(),
  approved_by uuid references public.school_users(id) on delete set null,
  approved_at timestamptz,
  sent_at timestamptz,
  dismissed_by uuid references public.school_users(id) on delete set null,
  dismissed_at timestamptz,
  dismiss_reason text
);
comment on table public.fee_reminders is
  'Draft fee reminders. Never auto-sent: send_fee_reminder() is the only path that queues a message. Rows are never deleted; dismiss is a status change.';
create unique index if not exists fee_reminders_one_draft_per_student
  on public.fee_reminders (student_id) where status = 'draft';
create index if not exists fee_reminders_school_run on public.fee_reminders (school_id, run_on desc);
alter table public.fee_reminders enable row level security;
drop policy if exists fee_reminders_select on public.fee_reminders;
create policy fee_reminders_select on public.fee_reminders for select
  using (auth_is_super_admin() or (school_id = auth_school_id() and auth_has_permission('finance.write')));

-- 4. Save the schedule (finance.write, own school, flag on).
create or replace function public.set_fee_reminder_schedule(
  p_enabled boolean,
  p_frequency text,
  p_run_weekday smallint,
  p_run_day_of_month smallint,
  p_channel text,
  p_min_balance numeric,
  p_min_days_between smallint
) returns void
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_school uuid := auth_school_id();
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

  insert into public.fee_reminder_schedules as s (
    school_id, enabled, frequency, run_weekday, run_day_of_month, channel, min_balance, min_days_between
  ) values (
    v_school, coalesce(p_enabled, false), p_frequency, p_run_weekday, p_run_day_of_month, p_channel, p_min_balance, p_min_days_between
  )
  on conflict (school_id) do update set
    enabled = excluded.enabled,
    frequency = excluded.frequency,
    run_weekday = excluded.run_weekday,
    run_day_of_month = excluded.run_day_of_month,
    channel = excluded.channel,
    min_balance = excluded.min_balance,
    min_days_between = excluded.min_days_between,
    updated_at = now();
end;
$$;
revoke all on function public.set_fee_reminder_schedule(boolean, text, smallint, smallint, text, numeric, smallint) from public, anon;
grant execute on function public.set_fee_reminder_schedule(boolean, text, smallint, smallint, text, numeric, smallint) to authenticated;

-- 5. Draft generator. Cron (service_role): every enabled+flagged school that is due today.
--    Finance user: own school only, immediately ("Draft now"), schedule not advanced.
--    Writes drafts only.
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
  v_body text;
  v_total integer := 0;
  v_template text := 'Dear {{guardian_name}}, this is a reminder that {{student_name}}''s fee balance at {{school_name}} is KES {{balance}}. Kindly clear it at your earliest convenience. If you have already paid, please ignore this message. Thank you.';
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

    for v_rec in
      select vb.student_id, vb.balance,
             (st.first_name || ' ' || st.last_name) as student_name,
             sg.guardian_user_id, su.full_name as guardian_name
        from public.v_student_balances vb
        join public.students st on st.id = vb.student_id
        join public.student_guardians sg on sg.student_id = st.id and sg.primary_contact = true
        join public.school_users su on su.id = sg.guardian_user_id
       where vb.school_id = v_sched.school_id
         and st.status = 'active'
         and vb.balance >= v_sched.min_balance
         and su.phone is not null
         -- one pending draft per learner
         and not exists (
           select 1 from public.fee_reminders fr
            where fr.student_id = vb.student_id and fr.status = 'draft')
         -- not reminded (sent) inside the minimum gap
         and not exists (
           select 1 from public.fee_reminders fr
            where fr.student_id = vb.student_id and fr.status = 'sent'
              and fr.sent_at > now() - make_interval(days => v_sched.min_days_between))
         -- do not double-message: skip learners with a pending or recently sent fee-threshold alert
         and not exists (
           select 1 from public.fee_threshold_alerts fta
            where fta.student_id = vb.student_id
              and (fta.status in ('draft', 'approved')
                   or (fta.status = 'sent' and fta.sent_at > now() - make_interval(days => v_sched.min_days_between))))
    loop
      -- Guardian opted out of fee reminders on this channel: no draft at all.
      if not public.notification_allowed(v_rec.guardian_user_id, 'fee_reminder', v_sched.channel) then
        continue;
      end if;

      v_body := public.render_template(v_template, jsonb_build_object(
        'guardian_name', coalesce(v_rec.guardian_name, 'Parent/Guardian'),
        'student_name', v_rec.student_name,
        'school_name', v_sched.school_name,
        'balance', to_char(v_rec.balance, 'FM999,999,999')
      ));

      insert into public.fee_reminders (
        school_id, student_id, guardian_user_id, channel, balance_at_generation, draft_body, run_on, trigger_type
      ) values (
        v_sched.school_id, v_rec.student_id, v_rec.guardian_user_id, v_sched.channel,
        v_rec.balance, v_body, v_today, case when v_is_cron then 'scheduled' else 'manual' end
      )
      on conflict do nothing;
      v_total := v_total + 1;
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

-- 6. Edit a draft's wording (finance.write, own school, draft only).
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
    raise exception 'This reminder has already been sent or dismissed.' using errcode = '55000';
  end if;
  if p_body is null or length(btrim(p_body)) = 0 or length(p_body) > 1000 then
    raise exception 'Message must be 1 to 1000 characters.' using errcode = '22023';
  end if;
  update public.fee_reminders set draft_body = btrim(p_body) where id = p_id;
end;
$$;
revoke all on function public.update_fee_reminder_draft(uuid, text) from public, anon;
grant execute on function public.update_fee_reminder_draft(uuid, text) to authenticated;

-- 7. Dismiss a draft (status change, never a delete).
create or replace function public.dismiss_fee_reminder(p_id uuid, p_reason text default null)
returns void
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_row record;
  v_me uuid;
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
    raise exception 'This reminder has already been sent or dismissed.' using errcode = '55000';
  end if;
  select id into v_me from public.school_users where auth_user_id = auth.uid();
  update public.fee_reminders
     set status = 'dismissed', dismissed_by = v_me, dismissed_at = now(),
         dismiss_reason = nullif(left(btrim(coalesce(p_reason, '')), 300), '')
   where id = p_id;
end;
$$;
revoke all on function public.dismiss_fee_reminder(uuid, text) from public, anon;
grant execute on function public.dismiss_fee_reminder(uuid, text) to authenticated;

-- 8. Approve and queue one reminder. Re-checks opt-out, phone and the CURRENT balance so a
--    family that paid since the draft was made is not chased. Returns true when a message was
--    queued, false when the draft was auto-dismissed with a reason (opt-out, no phone, paid).
create or replace function public.send_fee_reminder(p_id uuid)
returns boolean
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
  v_reason text;
begin
  select * into v_row from public.fee_reminders where id = p_id;
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
    raise exception 'This reminder has already been sent or dismissed.' using errcode = '55000';
  end if;

  select id into v_me from public.school_users where auth_user_id = auth.uid();
  select phone into v_phone from public.school_users where id = v_row.guardian_user_id;
  select min_balance into v_min from public.fee_reminder_schedules where school_id = v_row.school_id;
  select balance into v_balance from public.v_student_balances where student_id = v_row.student_id;

  if not public.notification_allowed(v_row.guardian_user_id, 'fee_reminder', v_row.channel) then
    v_reason := 'Not sent: guardian has opted out of fee reminders on this channel.';
  elsif v_phone is null then
    v_reason := 'Not sent: guardian has no phone number on file.';
  elsif coalesce(v_balance, 0) < coalesce(v_min, 1) then
    v_reason := 'Not sent: the balance has been cleared since this draft was made.';
  end if;

  if v_reason is not null then
    update public.fee_reminders
       set status = 'dismissed', dismissed_by = v_me, dismissed_at = now(), dismiss_reason = v_reason
     where id = p_id;
    return false;
  end if;

  insert into public.notification_logs (
    school_id, student_id, recipient_school_user_id, recipient_phone, recipient_type, channel, body,
    segments, sent_by, source_module
  ) values (
    v_row.school_id, v_row.student_id, v_row.guardian_user_id, v_phone, 'guardian', v_row.channel,
    v_row.draft_body, greatest(1, ceil(length(v_row.draft_body)::numeric / 160))::smallint, v_me, 'fee_reminder'
  );

  update public.fee_reminders
     set status = 'sent', approved_by = v_me, approved_at = now(), sent_at = now()
   where id = p_id;
  return true;
end;
$$;
revoke all on function public.send_fee_reminder(uuid) from public, anon;
grant execute on function public.send_fee_reminder(uuid) to authenticated;
