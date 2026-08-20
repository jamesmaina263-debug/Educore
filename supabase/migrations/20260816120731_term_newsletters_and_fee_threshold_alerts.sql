-- Two new features, both built on the existing Communication infrastructure
-- (communication_templates / queue_communication / notification_logs /
-- notification_allowed) rather than inventing a parallel messaging path:
--
-- 1. End-of-term newsletter, automatically to every guardian's email when a
--    term's end_date passes, merged with the fee structure for the *next*
--    term so parents can plan ahead — plus a manual "send now" button.
--    Idempotent (term_newsletter_log) so the daily cron sweep can never
--    double-send, and a manual click after the cron already ran is a no-op
--    that reports the existing count rather than erroring.
--
-- 2. Fee-arrears alerts once a student's balance crosses a school-configurable
--    threshold (schools.fee_alert_threshold, null = feature off). Deliberately
--    NOT auto-sent: check_fee_thresholds() only ever creates a 'draft' row in
--    fee_threshold_alerts for a Finance user to review, optionally polish with
--    AI (a Next.js action calling Gemini — grounded on the real balance/names
--    passed in, same pattern as report-card AI-drafted comments), edit, and
--    explicitly approve-and-send. This mirrors two patterns already
--    established elsewhere in this codebase: AI-drafted content never reaches
--    a parent unreviewed (report cards), and a human approves anything
--    debt/money-related before it goes out (Finance wizard step's
--    finance.write gate).

-- ---------------------------------------------------------------------------
-- 0. Schema: widen the communication_templates category vocabulary and add
--    the per-school threshold setting.
-- ---------------------------------------------------------------------------

alter table public.communication_templates drop constraint communication_templates_category_check;
alter table public.communication_templates add constraint communication_templates_category_check
  check (category in ('fee_reminder', 'absence_alert', 'result_published', 'announcement', 'other', 'term_newsletter', 'fee_threshold_alert'));

alter table public.schools add column fee_alert_threshold numeric(12,2);
comment on column public.schools.fee_alert_threshold is
  'Finance fee-arrears alert threshold (KES). Null or 0 = feature disabled for this school. When a student''s v_student_balances.balance meets or exceeds this, check_fee_thresholds() drafts a reminder into fee_threshold_alerts for a Finance user to review -- it is never auto-sent. Set via set_fee_alert_threshold(), surfaced in Finance > Configuration.';

create or replace function public.set_fee_alert_threshold(p_threshold numeric)
returns void
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_school_id uuid := auth_school_id();
begin
  if v_school_id is null or not auth_has_permission('finance.write') then
    raise exception 'Not authorized to change the fee alert threshold.';
  end if;
  if p_threshold is not null and p_threshold < 0 then
    raise exception 'Threshold cannot be negative.';
  end if;
  update public.schools set fee_alert_threshold = p_threshold where id = v_school_id;
end;
$$;
revoke all on function public.set_fee_alert_threshold(numeric) from public, anon;
grant execute on function public.set_fee_alert_threshold(numeric) to authenticated;

-- ---------------------------------------------------------------------------
-- 1. Term newsletters
-- ---------------------------------------------------------------------------

create table public.term_newsletter_log (
  id uuid primary key default gen_random_uuid(),
  school_id uuid not null references public.schools(id) on delete cascade,
  term_id uuid not null references public.terms(id) on delete cascade,
  trigger_type text not null check (trigger_type in ('automatic', 'manual')),
  sent_by uuid references public.school_users(id) on delete set null,
  recipient_count integer not null default 0,
  sent_at timestamptz not null default now(),
  unique (term_id)
);
comment on table public.term_newsletter_log is
  'One row per term once its newsletter has gone out -- the uniqueness on term_id is what makes send_term_newsletter() idempotent (a manual click after the automatic cron already ran, or two overlapping cron runs, both safely no-op and return the existing recipient_count).';

alter table public.term_newsletter_log enable row level security;
create policy term_newsletter_log_select on public.term_newsletter_log for select
  using (auth_is_super_admin() or (school_id = auth_school_id() and auth_has_permission('communication.write')));
-- No insert/update/delete policy for `authenticated` -- only send_term_newsletter() (security
-- definer) writes this table, matching the inventory_transfers / fee_threshold_alerts pattern
-- of "narrow RPC owns the write, RLS only ever grants read" for anything audit-relevant.

create or replace function public.send_term_newsletter(p_term_id uuid)
returns integer
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_term record;
  v_next_term record;
  v_school_name text;
  v_template_body text;
  v_existing_count integer;
  v_sender uuid;
  v_trigger_type text;
  v_count integer := 0;
  v_rec record;
  v_fee_lines text;
  v_fee_total numeric;
  v_fee_section text;
  v_body text;
begin
  select * into v_term from public.terms where id = p_term_id;
  if v_term.id is null then
    raise exception 'Term not found.';
  end if;

  v_trigger_type := case when auth.role() = 'service_role' then 'automatic' else 'manual' end;

  if v_trigger_type = 'manual' and not (
    auth_is_super_admin() or (v_term.school_id = auth_school_id() and auth_has_permission('communication.write'))
  ) then
    raise exception 'Not authorized to send this newsletter.';
  end if;

  -- Idempotent: already sent for this term -> report the existing count, don't resend.
  select recipient_count into v_existing_count from public.term_newsletter_log where term_id = p_term_id;
  if v_existing_count is not null then
    return v_existing_count;
  end if;

  select name into v_school_name from public.schools where id = v_term.school_id;

  -- The next term chronologically at this school, so the newsletter can carry
  -- the fee structure parents actually need to plan for.
  select * into v_next_term from public.terms
    where school_id = v_term.school_id and start_date > v_term.end_date
    order by start_date asc limit 1;

  select body into v_template_body from public.communication_templates
    where school_id = v_term.school_id and category = 'term_newsletter'
    order by created_at desc limit 1;
  if v_template_body is null then
    v_template_body := E'Dear {{guardian_name}},\n\n{{term_name}} at {{school_name}} has now ended. We hope {{student_name}} had a great term.\n\n{{fee_section}}\n\nThank you for your continued partnership.';
  end if;

  select id into v_sender from public.school_users where auth_user_id = auth.uid();

  for v_rec in
    select distinct
      sg.guardian_user_id, su.full_name as guardian_name, su.email as guardian_email,
      st.id as student_id, (st.first_name || ' ' || st.last_name) as student_name,
      -- students.current_class_id actually references streams.id, not classes.id (misleading
      -- column name) -- fee_structures.class_id references classes.id, so the real class comes
      -- via streams.class_id.
      str.class_id as actual_class_id
    from public.students st
    join public.student_guardians sg on sg.student_id = st.id
    join public.school_users su on su.id = sg.guardian_user_id
    left join public.streams str on str.id = st.current_class_id
    where st.school_id = v_term.school_id and st.status = 'active' and su.email is not null
  loop
    v_fee_lines := null;
    v_fee_total := null;
    if v_next_term.id is not null and v_rec.actual_class_id is not null then
      select string_agg(fi.name || ': KES ' || to_char(fi.amount, 'FM999,999,999'), E'\n' order by fi.name), sum(fi.amount)
        into v_fee_lines, v_fee_total
        from public.fee_structures fs
        join public.fee_items fi on fi.fee_structure_id = fs.id
        where fs.school_id = v_term.school_id and fs.term_id = v_next_term.id
          and fs.class_id = v_rec.actual_class_id and fs.is_active = true;
    end if;

    v_fee_section := case
      when v_fee_lines is not null then
        'Fee structure for ' || coalesce(v_next_term.name, 'the next term') || ':' || E'\n' || v_fee_lines
        || E'\nTotal: KES ' || to_char(v_fee_total, 'FM999,999,999')
      else 'The fee structure for the next term will be shared once it is published.'
    end;

    v_body := public.render_template(v_template_body, jsonb_build_object(
      'guardian_name', coalesce(v_rec.guardian_name, 'Parent/Guardian'),
      'student_name', v_rec.student_name,
      'school_name', v_school_name,
      'term_name', v_term.name,
      'next_term_name', coalesce(v_next_term.name, 'the next term'),
      'fee_section', v_fee_section
    ));

    if not public.notification_allowed(v_rec.guardian_user_id, 'term_newsletter', 'email') then
      continue;
    end if;

    insert into public.notification_logs (
      school_id, student_id, recipient_email, recipient_type, channel, subject, body,
      segments, sent_by, recipient_school_user_id, source_module
    ) values (
      v_term.school_id, v_rec.student_id, v_rec.guardian_email, 'guardian', 'email',
      v_school_name || ' -- ' || v_term.name || ' Newsletter', v_body, 1, v_sender,
      v_rec.guardian_user_id, 'term_newsletter'
    );
    v_count := v_count + 1;
  end loop;

  insert into public.term_newsletter_log (school_id, term_id, trigger_type, sent_by, recipient_count)
  values (v_term.school_id, p_term_id, v_trigger_type, v_sender, v_count);

  return v_count;
end;
$$;
revoke all on function public.send_term_newsletter(uuid) from public, anon;
grant execute on function public.send_term_newsletter(uuid) to authenticated;

-- Cron-facing sweep: every term across every school whose end_date has passed
-- and has no log row yet. Called by the service-role key from a scheduled
-- route, same shape as expire_trials()/mark_invoices_overdue().
create or replace function public.run_term_newsletter_sweep()
returns integer
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_term_id uuid;
  v_total integer := 0;
begin
  if not (auth_is_super_admin() or auth.role() = 'service_role') then
    raise exception 'Not authorized to run the newsletter sweep.';
  end if;

  for v_term_id in
    select t.id from public.terms t
    left join public.term_newsletter_log l on l.term_id = t.id
    where t.end_date <= current_date and l.id is null
  loop
    v_total := v_total + public.send_term_newsletter(v_term_id);
  end loop;

  return v_total;
end;
$$;
revoke all on function public.run_term_newsletter_sweep() from public, anon;
grant execute on function public.run_term_newsletter_sweep() to authenticated;

-- ---------------------------------------------------------------------------
-- 2. Fee-threshold alerts (draft-and-approve, optionally AI-polished)
-- ---------------------------------------------------------------------------

create table public.fee_threshold_alerts (
  id uuid primary key default gen_random_uuid(),
  school_id uuid not null references public.schools(id) on delete cascade,
  student_id uuid not null references public.students(id) on delete cascade,
  guardian_user_id uuid not null references public.school_users(id) on delete cascade,
  balance_at_generation numeric(12,2) not null,
  threshold_at_generation numeric(12,2) not null,
  draft_body text not null,
  ai_drafted boolean not null default false,
  status text not null default 'draft' check (status in ('draft', 'approved', 'sent', 'dismissed')),
  generated_at timestamptz not null default now(),
  approved_by uuid references public.school_users(id) on delete set null,
  approved_at timestamptz,
  sent_at timestamptz,
  dismissed_by uuid references public.school_users(id) on delete set null,
  dismissed_at timestamptz,
  dismiss_reason text
);
comment on table public.fee_threshold_alerts is
  'Draft fee-arrears reminders, never auto-sent. check_fee_thresholds() (security definer) is the only writer of new rows; a finance.write holder can edit draft_body / dismiss directly (RLS update below), and send_fee_threshold_alert() (security definer) is the only path that actually queues the message into notification_logs, since that requires bridging into Communication''s own permission domain.';

-- One active (draft/approved) alert per student at a time -- re-running the
-- check doesn't spam a family with duplicate drafts while one is still
-- pending review.
create unique index fee_threshold_alerts_active_per_student
  on public.fee_threshold_alerts (student_id)
  where status in ('draft', 'approved');

alter table public.fee_threshold_alerts enable row level security;

create policy fee_threshold_alerts_select on public.fee_threshold_alerts for select
  using (auth_is_super_admin() or (school_id = auth_school_id() and auth_has_permission('finance.write')));

-- Lets a Finance user edit draft_body (before sending) or dismiss (status/dismissed_*
-- columns) via a plain client .update() -- no RPC needed for these, same as editing an
-- invoice line elsewhere in this codebase. Approving-and-sending still goes through the
-- RPC below because it must also write to notification_logs atomically.
create policy fee_threshold_alerts_update on public.fee_threshold_alerts for update
  using (auth_is_super_admin() or (school_id = auth_school_id() and auth_has_permission('finance.write')))
  with check (auth_is_super_admin() or (school_id = auth_school_id() and auth_has_permission('finance.write')));

-- No insert/delete policy for `authenticated` -- rows are only ever created by
-- check_fee_thresholds() and never hard-deleted (dismiss is a status change, keeping
-- the audit trail, consistent with term_newsletter_log/inventory_transfers above).

create or replace function public.check_fee_thresholds()
returns integer
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_is_cron boolean := (auth.role() = 'service_role');
  v_caller_school uuid;
  v_school record;
  v_template_body text;
  v_body text;
  v_rec record;
  v_total integer := 0;
begin
  if not v_is_cron then
    v_caller_school := auth_school_id();
    if not (auth_is_super_admin() or (v_caller_school is not null and auth_has_permission('finance.write'))) then
      raise exception 'Not authorized to check fee thresholds.';
    end if;
  end if;

  for v_school in
    select id, name, fee_alert_threshold from public.schools
    where fee_alert_threshold is not null and fee_alert_threshold > 0
      and (v_is_cron or id = v_caller_school)
  loop
    select body into v_template_body from public.communication_templates
      where school_id = v_school.id and category = 'fee_threshold_alert'
      order by created_at desc limit 1;
    if v_template_body is null then
      v_template_body := 'Dear {{guardian_name}}, this is a reminder that {{student_name}}''s fee balance at {{school_name}} currently stands at KES {{balance}}. Kindly clear the outstanding amount at your earliest convenience. Thank you.';
    end if;

    for v_rec in
      select vb.student_id, vb.balance, (st.first_name || ' ' || st.last_name) as student_name,
             sg.guardian_user_id, su.full_name as guardian_name
        from public.v_student_balances vb
        join public.students st on st.id = vb.student_id
        join public.student_guardians sg on sg.student_id = st.id and sg.primary_contact = true
        join public.school_users su on su.id = sg.guardian_user_id
        where vb.school_id = v_school.id
          and vb.balance >= v_school.fee_alert_threshold
          and st.status = 'active'
          and not exists (
            select 1 from public.fee_threshold_alerts fta
            where fta.student_id = vb.student_id and fta.status in ('draft', 'approved')
          )
    loop
      v_body := public.render_template(v_template_body, jsonb_build_object(
        'guardian_name', coalesce(v_rec.guardian_name, 'Parent/Guardian'),
        'student_name', v_rec.student_name,
        'school_name', v_school.name,
        'balance', to_char(v_rec.balance, 'FM999,999,999')
      ));

      insert into public.fee_threshold_alerts (
        school_id, student_id, guardian_user_id, balance_at_generation, threshold_at_generation, draft_body
      ) values (
        v_school.id, v_rec.student_id, v_rec.guardian_user_id, v_rec.balance, v_school.fee_alert_threshold, v_body
      );
      v_total := v_total + 1;
    end loop;
  end loop;

  return v_total;
end;
$$;
revoke all on function public.check_fee_thresholds() from public, anon;
grant execute on function public.check_fee_thresholds() to authenticated;

-- Approve-and-send: the only path that actually delivers a fee_threshold_alerts row.
-- Bridges from Finance's permission domain into Communication's protected table
-- (notification_logs), which is exactly why this needs security definer rather than
-- just relying on the table's own update policy.
create or replace function public.send_fee_threshold_alert(p_alert_id uuid)
returns boolean
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_alert record;
  v_school_name text;
  v_sender uuid;
  v_rows integer;
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
    -- Guardian opted out of this category -- mark sent (so it stops showing as
    -- pending review) without actually queuing a message, same skip-not-fail
    -- semantics queue_communication uses elsewhere. Legitimate terminal state,
    -- not a failure -- returns true.
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
    -- No phone, no email -- nothing was actually queued. Do NOT mark 'sent'
    -- (that would silently report success with no message ever delivered).
    -- Mark 'dismissed' with a clear reason so Finance sees it needs the
    -- guardian's contact info fixed, not that it was handled.
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
$$;
revoke all on function public.send_fee_threshold_alert(uuid) from public, anon;
grant execute on function public.send_fee_threshold_alert(uuid) to authenticated;
