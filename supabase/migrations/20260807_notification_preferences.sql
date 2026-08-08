-- Gap analysis Tier 2 #13: notification preferences. Parents/staff currently have zero control
-- over which comms channel/category reaches them. Opt-out model (default enabled=true when no row
-- exists) — safer default than opt-in, since fee reminders and absence alerts are the kind of
-- message a school genuinely needs to be able to reach someone with unless they explicitly said no.
-- Self-scoped: a school_user manages only their own row, via the same auth.uid()->school_users
-- lookup pattern used across every other self-read RLS policy in this project (Portals, Phase 5
-- prep sessions).

create table notification_preferences (
  id uuid primary key default gen_random_uuid(),
  school_user_id uuid not null references school_users(id) on delete cascade,
  category text not null check (category in ('fee_reminder','absence_alert','result_published','announcement','other')),
  channel text not null check (channel in ('sms','email','whatsapp')),
  enabled boolean not null default true,
  updated_at timestamptz not null default now(),
  unique (school_user_id, category, channel)
);

comment on table notification_preferences is
  'Per-recipient opt-out of a communication category/channel combination. Absence of a row means
   enabled (opt-out default, not opt-in) — a school_user only shows up here once they have actually
   changed something from the default. Self-managed only; not something staff configure for a
   parent on their behalf.';

alter table notification_preferences enable row level security;

create policy notification_preferences_select_own on notification_preferences
  for select using (
    exists (select 1 from school_users su where su.id = notification_preferences.school_user_id and su.auth_user_id = (select auth.uid()))
  );

create policy notification_preferences_insert_own on notification_preferences
  for insert with check (
    exists (select 1 from school_users su where su.id = notification_preferences.school_user_id and su.auth_user_id = (select auth.uid()))
  );

create policy notification_preferences_update_own on notification_preferences
  for update using (
    exists (select 1 from school_users su where su.id = notification_preferences.school_user_id and su.auth_user_id = (select auth.uid()))
  ) with check (
    exists (select 1 from school_users su where su.id = notification_preferences.school_user_id and su.auth_user_id = (select auth.uid()))
  );

create policy notification_preferences_delete_own on notification_preferences
  for delete using (
    exists (select 1 from school_users su where su.id = notification_preferences.school_user_id and su.auth_user_id = (select auth.uid()))
  );

-- Shared helper: true unless the recipient explicitly turned this category/channel off.
-- SECURITY DEFINER because both queue_communication (already SECURITY DEFINER) and the
-- absence-alert trigger (fires as whatever role wrote student_attendance) need to read across
-- school_users boundaries that the caller's own RLS wouldn't otherwise allow.
create or replace function notification_allowed(p_school_user_id uuid, p_category text, p_channel text)
returns boolean
language sql
security definer
set search_path to 'public'
stable
as $$
  select coalesce(
    (select enabled from notification_preferences
      where school_user_id = p_school_user_id and category = p_category and channel = p_channel),
    true
  );
$$;

revoke execute on function notification_allowed(uuid, text, text) from public, anon;
grant execute on function notification_allowed(uuid, text, text) to authenticated;

-- queue_communication, now preference-aware. Same signature as the channel-aware version plus one
-- new optional p_category (defaults to the template's own category when a template is used, else
-- null). A null category never gets filtered — ad-hoc composed messages with no template keep
-- working exactly as before; only category-tagged sends (template-based, or the absence-alert
-- trigger below) actually consult preferences. Recipients may now optionally carry a
-- "school_user_id" key so the preference lookup doesn't need a guess-by-phone join.
create or replace function public.queue_communication(
  p_recipients jsonb,
  p_template_id uuid default null,
  p_body text default null,
  p_channel text default 'sms',
  p_subject text default null,
  p_category text default null
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
  if p_channel not in ('sms','email','whatsapp') then
    raise exception 'channel must be sms, email, or whatsapp';
  end if;

  if p_template_id is not null then
    select body, category into v_template_body, v_template_category
      from communication_templates where id = p_template_id and school_id = v_school_id;
    if v_template_body is null then
      raise exception 'Template not found.';
    end if;
  end if;

  v_effective_category := coalesce(p_category, v_template_category);

  select id into v_sender from school_users where auth_user_id = auth.uid();

  for v_recipient in select * from jsonb_array_elements(p_recipients) loop
    v_rendered := render_template(coalesce(v_template_body, p_body), coalesce(v_recipient->'values', '{}'::jsonb));

    if p_channel = 'email' and nullif(v_recipient->>'email', '') is null then
      continue; -- skip recipients with no email on file rather than fail the whole batch
    end if;
    if p_channel in ('sms','whatsapp') and nullif(v_recipient->>'phone', '') is null then
      continue;
    end if;

    v_recipient_school_user_id := nullif(v_recipient->>'school_user_id', '')::uuid;
    if v_effective_category is not null and v_recipient_school_user_id is not null
       and not notification_allowed(v_recipient_school_user_id, v_effective_category, p_channel) then
      continue; -- recipient opted out of this category/channel — not a failure, just skipped
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

revoke execute on function queue_communication(jsonb, uuid, text, text, text, text) from public, anon;
grant execute on function queue_communication(jsonb, uuid, text, text, text, text) to authenticated;

-- Old 5-arg overload (pre-category) must be dropped explicitly — Postgres treats a different
-- signature as a distinct function, not a replacement. Learned this the hard way in Phase 3
-- (queue_communication accidental overload gotcha); routine now.
drop function if exists queue_communication(jsonb, uuid, text, text, text);

-- Absence-alert trigger now also respects the guardian's own preference for
-- (absence_alert, sms) before inserting — same helper, same opt-out-default semantics. This is
-- the one place notification_preferences interacts with a direct notification_logs insert rather
-- than going through queue_communication.
create or replace function check_consecutive_absences() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  v_streak integer;
  v_guardian_phone text;
  v_guardian_school_user_id uuid;
  v_student_name text;
  v_school_name text;
  v_school_id uuid;
begin
  if new.status != 'absent' then
    return new;
  end if;

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
    return new;
  end if;

  select st.school_id, (st.first_name || ' ' || st.last_name), s.name
    into v_school_id, v_student_name, v_school_name
  from students st join schools s on s.id = st.school_id
  where st.id = new.student_id;

  select su.id, su.phone into v_guardian_school_user_id, v_guardian_phone
  from student_guardians sg
  join school_users su on su.id = sg.guardian_user_id
  where sg.student_id = new.student_id and sg.primary_contact = true
  limit 1;

  if v_guardian_phone is null then
    return new;
  end if;

  if not notification_allowed(v_guardian_school_user_id, 'absence_alert', 'sms') then
    return new; -- guardian opted out of absence alerts over SMS
  end if;

  insert into notification_logs (school_id, student_id, recipient_phone, recipient_type, channel, body, segments, sent_by)
  values (
    v_school_id, new.student_id, v_guardian_phone, 'guardian', 'sms',
    format('%s: %s has been absent for 3 consecutive school days. Please contact the school office.', v_school_name, v_student_name),
    1, null
  );

  return new;
end;
$$;

revoke execute on function check_consecutive_absences() from public, anon, authenticated;

-- Gap analysis Tier 2 #12: public admissions application form. A prospective family filling this
-- in has no admission number yet — the school assigns a real one during Admissions review, same as
-- every other applied-status student. This free-text field lets them note which grade they're
-- applying for and anything else relevant, visible to staff on the Admissions pipeline; it is
-- deliberately NOT a class_id foreign key (no class assignment happens until the school approves
-- and enrolls, per the existing state machine — this is just context for that human decision).
alter table students add column application_notes text;

comment on column students.application_notes is
  'Free-text note captured at public application time (e.g. desired grade) — set once via /apply,
   never edited by the enrollment workflow itself. Null for students entered directly by staff.';
