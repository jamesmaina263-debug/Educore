-- WP 3.5: same-day absence alert (database core). ADDITIVE ONLY, dark, DRY-RUN.
--
-- Adds one flag, three tables and functions. The existing 3-consecutive-day absence SMS trigger and its schedule are NOT touched.
-- Same pattern as WP 3.1/3.2: the evaluate function only writes 'would_send' log rows; nothing is sent to anyone. Sending needs
-- approved templates, the owner's cost decision and a test-number-first rollout, and is a separate reviewed change.
--
-- Rules (from docs/designs/wp-3-5-same-day-absence.md, read against the live schema on 7 Nov 2026):
--   * a school is in scope only if feature.attendance.same_day_absence is on for it AND its own switch (same_day_absence_settings.enabled,
--     default false) is on: two locks;
--   * after the school's cut-off time (default 10:00 Africa/Nairobi, Monday to Friday) a learner whose class-register status TODAY is
--     'absent' (current status, so a correction to present or late before the run means no alert) gets at most ONE entry per learner
--     per day (unique key), for the learner's primary-contact guardian, if that guardian has a usable phone and has not opted out;
--   * only inside a 3-hour window from the cut-off, so a late cron run never sends a stale alert;
--   * the log stores ids and a status, never a name, a phone or a message.
-- Design assumption that did NOT hold: the design says "no absence note from the guardian today", but no table for guardian absence
-- notes exists in the schema. v1 therefore cannot check one; it is recorded here rather than invented.

insert into public.platform_feature_flags (key, label, description)
select 'feature.attendance.same_day_absence',
       'Same-day absence alert to the guardian',
       'After the school''s cut-off time, a learner marked absent on the class register today triggers one message to the primary-contact guardian. Needs the school''s own switch as well. Dry-run only until templates are approved. Off by default.'
where not exists (select 1 from public.platform_feature_flags where lower(key) = 'feature.attendance.same_day_absence');

create table if not exists public.same_day_absence_settings (
  school_id uuid primary key references public.schools(id) on delete cascade,
  enabled boolean not null default false,
  cutoff_time time not null default '10:00' check (cutoff_time between time '08:00' and time '14:00'),
  updated_by uuid references public.school_users(id) on delete set null,
  updated_at timestamptz not null default now()
);
comment on table public.same_day_absence_settings is 'WP 3.5: per-school switch (default OFF) and the cut-off time after which attendance is treated as marked. Written only by same_day_absence_settings_save().';

create table if not exists public.same_day_absence_optouts (
  school_id uuid not null references public.schools(id) on delete cascade,
  phone text not null check (phone ~ '^\+254[0-9]{9}$'),
  created_at timestamptz not null default now(),
  primary key (school_id, phone)
);
comment on table public.same_day_absence_optouts is 'WP 3.5: guardian phone numbers (normalised +254...) that asked to stop same-day absence alerts at a school. Written by same_day_absence_opt_out() (service role, called by the bot STOP keyword in a later change).';

create table if not exists public.same_day_absence_log (
  id uuid primary key default gen_random_uuid(),
  school_id uuid not null references public.schools(id) on delete cascade,
  student_id uuid not null references public.students(id) on delete cascade,
  attendance_date date not null,
  status text not null default 'would_send' check (status in ('would_send', 'sent', 'failed')),
  created_at timestamptz not null default now(),
  constraint same_day_absence_log_once unique (student_id, attendance_date)
);
comment on table public.same_day_absence_log is 'WP 3.5: one row per absent learner per day (ids and status only: no name, phone or text). The unique key makes the alert go out once.';
create index if not exists same_day_absence_log_school_created on public.same_day_absence_log (school_id, created_at desc);

alter table public.same_day_absence_settings enable row level security;
alter table public.same_day_absence_optouts enable row level security;
alter table public.same_day_absence_log enable row level security;
revoke all on public.same_day_absence_settings from public, anon, authenticated;
revoke all on public.same_day_absence_optouts from public, anon, authenticated;
revoke all on public.same_day_absence_log from public, anon, authenticated;

create or replace function public.same_day_absence_settings_get()
returns jsonb
language plpgsql
stable
security definer
set search_path to 'public'
as $function$
declare
  v_school uuid := public.auth_school_id();
  v_role text;
  s public.same_day_absence_settings;
begin
  select r.name into v_role from public.school_users su join public.roles r on r.id = su.role_id
   where su.auth_user_id = auth.uid() and su.school_id = v_school and su.status = 'active' limit 1;
  if v_school is null or v_role is null or v_role not in ('school_owner', 'principal', 'deputy_principal')
     or not public.school_has_feature_flag(v_school, 'feature.attendance.same_day_absence') then
    return jsonb_build_object('eligible', false);
  end if;
  select * into s from public.same_day_absence_settings where school_id = v_school;
  if not found then
    s.enabled := false; s.cutoff_time := '10:00';
  end if;
  return jsonb_build_object('eligible', true, 'enabled', s.enabled, 'cutoff_time', s.cutoff_time);
end
$function$;

create or replace function public.same_day_absence_settings_save(p_enabled boolean, p_cutoff_time time)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_school uuid := public.auth_school_id();
  v_su uuid;
  v_role text;
begin
  select su.id, r.name into v_su, v_role from public.school_users su join public.roles r on r.id = su.role_id
   where su.auth_user_id = auth.uid() and su.school_id = v_school and su.status = 'active' limit 1;
  if v_school is null or v_su is null or v_role not in ('school_owner', 'principal', 'deputy_principal') then
    raise exception 'only a school owner, principal or deputy principal may change absence alert settings' using errcode = '42501';
  end if;
  if not public.school_has_feature_flag(v_school, 'feature.attendance.same_day_absence') then
    return jsonb_build_object('status', 'disabled');
  end if;
  -- A cut-off outside 08:00 to 14:00 raises check_violation, shown by the caller as "invalid value".
  insert into public.same_day_absence_settings as d (school_id, enabled, cutoff_time, updated_by, updated_at)
  values (v_school, coalesce(p_enabled, false), coalesce(p_cutoff_time, time '10:00'), v_su, now())
  on conflict (school_id) do update set
    enabled = excluded.enabled, cutoff_time = excluded.cutoff_time, updated_by = excluded.updated_by, updated_at = now();
  return jsonb_build_object('status', 'saved');
end
$function$;

-- Service role only. Records that a guardian number asked to stop alerts at a school. Idempotent.
create or replace function public.same_day_absence_opt_out(p_school uuid, p_phone text)
returns boolean
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_phone text := public.director_normalize_phone(p_phone);
begin
  if v_phone is null or p_school is null then
    return false;
  end if;
  insert into public.same_day_absence_optouts (school_id, phone) values (p_school, v_phone) on conflict do nothing;
  return true;
end
$function$;

-- Service role only. For every school with both locks on whose cut-off has passed (inside the 3-hour window, Monday to Friday),
-- records a 'would_send' row for each learner currently marked absent on the class register today whose primary-contact guardian
-- has a usable phone and has not opted out, once per learner per day, and returns the rows for the caller to count or (later) send.
-- p_now is a parameter so tests can control the clock.
create or replace function public.same_day_absence_evaluate(p_now timestamptz default now())
returns table (log_id uuid, school_id uuid, student_id uuid, guardian_user_id uuid, phone text)
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_today date := (p_now at time zone 'Africa/Nairobi')::date;
  v_time time := (p_now at time zone 'Africa/Nairobi')::time;
  v_dow integer := extract(isodow from (p_now at time zone 'Africa/Nairobi'))::int;
  s record;
  a record;
  v_id uuid;
begin
  if v_dow > 5 then
    return;
  end if;

  for s in select st.school_id, st.cutoff_time from public.same_day_absence_settings st
            where st.enabled order by st.school_id loop
    if not public.school_has_feature_flag(s.school_id, 'feature.attendance.same_day_absence') then
      continue;
    end if;
    if v_time < s.cutoff_time or v_time >= s.cutoff_time + interval '3 hours' then
      continue;
    end if;

    for a in
      select att.student_id as sid, g.guardian_user_id as gid, public.director_normalize_phone(gu.phone) as ph
        from public.student_attendance att
        join public.students stu on stu.id = att.student_id and stu.status = 'active'
        join lateral (
          select sg.guardian_user_id from public.student_guardians sg
           where sg.student_id = att.student_id and sg.primary_contact = true
           order by sg.created_at limit 1
        ) g on true
        join public.school_users gu on gu.id = g.guardian_user_id and gu.status = 'active'
       where att.school_id = s.school_id and att.attendance_date = v_today
         and att.session = 'class' and att.status = 'absent'
         and public.director_normalize_phone(gu.phone) is not null
         and not exists (select 1 from public.same_day_absence_optouts o
                          where o.school_id = s.school_id and o.phone = public.director_normalize_phone(gu.phone))
       order by att.student_id
    loop
      v_id := null;
      insert into public.same_day_absence_log (school_id, student_id, attendance_date, created_at)
      values (s.school_id, a.sid, v_today, p_now)
      on conflict on constraint same_day_absence_log_once do nothing
      returning id into v_id;
      if v_id is not null then
        return query select v_id, s.school_id, a.sid, a.gid, a.ph;
      end if;
    end loop;
  end loop;
end
$function$;

-- Service role only. Used once real sending is approved: move a would_send row to sent or failed.
create or replace function public.same_day_absence_mark(p_log_id uuid, p_status text)
returns boolean
language plpgsql
security definer
set search_path to 'public'
as $function$
begin
  if p_status not in ('sent', 'failed') then
    raise exception 'status must be sent or failed';
  end if;
  update public.same_day_absence_log set status = p_status where id = p_log_id and status = 'would_send';
  return found;
end
$function$;

revoke all on function public.same_day_absence_settings_get() from public, anon;
revoke all on function public.same_day_absence_settings_save(boolean, time) from public, anon;
revoke all on function public.same_day_absence_opt_out(uuid, text) from public, anon, authenticated;
revoke all on function public.same_day_absence_evaluate(timestamptz) from public, anon, authenticated;
revoke all on function public.same_day_absence_mark(uuid, text) from public, anon, authenticated;
grant execute on function public.same_day_absence_settings_get() to authenticated, service_role;
grant execute on function public.same_day_absence_settings_save(boolean, time) to authenticated, service_role;
grant execute on function public.same_day_absence_opt_out(uuid, text) to service_role;
grant execute on function public.same_day_absence_evaluate(timestamptz) to service_role;
grant execute on function public.same_day_absence_mark(uuid, text) to service_role;

-- Rollback: the flag is off and every school's switch defaults off, so nothing runs. To remove: drop the five functions and the three
-- tables, delete the flag row.
