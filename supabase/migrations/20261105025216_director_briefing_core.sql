-- WP 3.1: director morning briefing + Saturday digest (database core). ADDITIVE ONLY, flag off for every school.
--
-- Adds one flag, two tables and functions. No existing function, table, policy, trigger, constraint or grant is touched.
-- Follows WP 3.2 (director alerts) exactly so the two work as a pair and nothing is built twice:
--   * recipients = directors with an active director_whatsapp_numbers registration that still passes
--     director_whatsapp_lookup() (WP 3.3), in a school with BOTH feature.bot.director and feature.bot.director_briefing on;
--   * v1 is DRY-RUN: director_briefing_evaluate() only writes 'would_send' log rows and returns the figures for the
--     caller to format. Nothing is sent to anyone. The log stores kind + dedupe key + status, never the figures.
--   * the figures come from fixed queries on the same basis as the bot, the cashbook and the alerts (nothing generated).
--
-- What a briefing is:
--   morning  Monday to Friday: collections since the previous school day, attendance on that school day, outstanding fees.
--   saturday weekly digest: collections of the last 7 days against the 7 before, Monday to Friday attendance rate,
--            outstanding fees.
--   Sunday: nothing. A briefing is only produced in a window of 3 hours from the school's briefing time (default 07:00,
--   which is where the alerts' quiet hours end), so a late cron run never sends a stale briefing.

insert into public.platform_feature_flags (key, label, description)
select 'feature.bot.director_briefing',
       'Director WhatsApp morning briefing and Saturday digest',
       'A short morning summary (Monday to Friday) and a weekly digest (Saturday) for directors who registered their own WhatsApp number. Needs feature.bot.director. Dry-run only until templates are approved. Off by default.'
where not exists (select 1 from public.platform_feature_flags where lower(key) = 'feature.bot.director_briefing');

create table if not exists public.director_briefing_settings (
  school_id uuid primary key references public.schools(id) on delete cascade,
  morning_enabled boolean not null default true,
  saturday_enabled boolean not null default true,
  briefing_time time not null default '07:00' check (briefing_time between time '06:00' and time '10:00'),
  updated_by uuid references public.school_users(id) on delete set null,
  updated_at timestamptz not null default now()
);
comment on table public.director_briefing_settings is 'WP 3.1: per-school briefing switches and time. Defaults apply when a school has no row. Written only by director_briefing_settings_save().';

create table if not exists public.director_briefing_log (
  id uuid primary key default gen_random_uuid(),
  school_id uuid not null references public.schools(id) on delete cascade,
  school_user_id uuid not null references public.school_users(id) on delete cascade,
  kind text not null check (kind in ('morning', 'saturday')),
  dedupe_key text not null check (char_length(dedupe_key) between 1 and 40),
  status text not null default 'would_send' check (status in ('would_send', 'sent', 'failed')),
  created_at timestamptz not null default now(),
  constraint director_briefing_log_once unique (school_user_id, dedupe_key)
);
comment on table public.director_briefing_log is 'WP 3.1: one row per briefing per director per day (kind and key only, never the figures). The unique key makes a briefing go out once.';
create index if not exists director_briefing_log_school_created on public.director_briefing_log (school_id, created_at desc);

-- No policies and no client grants: only the SECURITY DEFINER functions below touch these tables.
alter table public.director_briefing_settings enable row level security;
alter table public.director_briefing_log enable row level security;
revoke all on public.director_briefing_settings from public, anon, authenticated;
revoke all on public.director_briefing_log from public, anon, authenticated;

create or replace function public.director_briefing_settings_get()
returns jsonb
language plpgsql
stable
security definer
set search_path to 'public'
as $function$
declare
  v_school uuid := public.auth_school_id();
  v_role text;
  s public.director_briefing_settings;
begin
  select r.name into v_role from public.school_users su join public.roles r on r.id = su.role_id
   where su.auth_user_id = auth.uid() and su.school_id = v_school and su.status = 'active' limit 1;
  if v_school is null or v_role is null or v_role not in ('school_owner', 'principal', 'deputy_principal')
     or not public.school_has_feature_flag(v_school, 'feature.bot.director_briefing') then
    return jsonb_build_object('eligible', false);
  end if;
  select * into s from public.director_briefing_settings where school_id = v_school;
  if not found then
    s.morning_enabled := true; s.saturday_enabled := true; s.briefing_time := '07:00';
  end if;
  return jsonb_build_object('eligible', true, 'morning_enabled', s.morning_enabled,
    'saturday_enabled', s.saturday_enabled, 'briefing_time', s.briefing_time);
end
$function$;

create or replace function public.director_briefing_settings_save(p_morning_enabled boolean, p_saturday_enabled boolean, p_briefing_time time)
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
    raise exception 'only a school owner, principal or deputy principal may change briefing settings' using errcode = '42501';
  end if;
  if not public.school_has_feature_flag(v_school, 'feature.bot.director_briefing') then
    return jsonb_build_object('status', 'disabled');
  end if;
  -- A time outside 06:00 to 10:00 raises check_violation, which the caller shows as "invalid value".
  insert into public.director_briefing_settings as d (school_id, morning_enabled, saturday_enabled, briefing_time, updated_by, updated_at)
  values (v_school, coalesce(p_morning_enabled, true), coalesce(p_saturday_enabled, true), coalesce(p_briefing_time, time '07:00'), v_su, now())
  on conflict (school_id) do update set
    morning_enabled = excluded.morning_enabled, saturday_enabled = excluded.saturday_enabled,
    briefing_time = excluded.briefing_time, updated_by = excluded.updated_by, updated_at = now();
  return jsonb_build_object('status', 'saved');
end
$function$;

-- Internal: the figures for one school. p_kind is 'morning' or 'saturday'; p_today is the Kenya date of the run.
-- Not callable by anyone but other definer functions.
create or replace function public.director_briefing_payload(p_school uuid, p_kind text, p_today date)
returns jsonb
language plpgsql
stable
security definer
set search_path to 'public'
as $function$
declare
  v_from date;           -- previous school day (morning)
  v_cur numeric; v_prev numeric; v_count integer; v_att jsonb; v_out jsonb; v_rate numeric;
begin
  select jsonb_build_object('outstanding', coalesce(sum(b.balance) filter (where b.balance > 0), 0),
                            'learners_owing', count(*) filter (where b.balance > 0))
    into v_out
    from public.v_student_balances b join public.students s on s.id = b.student_id
   where b.school_id = p_school and s.status = 'active';

  if p_kind = 'morning' then
    v_from := case extract(isodow from p_today)::int when 1 then p_today - 3 else p_today - 1 end;
    select coalesce(sum(amount), 0), count(*) into v_cur, v_count
      from public.payments
     where school_id = p_school and status in ('confirmed', 'recorded', 'unallocated')
       and (recorded_at at time zone 'Africa/Nairobi')::date between v_from and p_today - 1;
    select jsonb_build_object(
             'active_learners', (select count(*) from public.students where school_id = p_school and status = 'active'),
             'marked', count(distinct a.student_id),
             'present', count(distinct a.student_id) filter (where a.status = 'present'),
             'late', count(distinct a.student_id) filter (where a.status = 'late'),
             'absent', count(distinct a.student_id) filter (where a.status = 'absent'))
      into v_att
      from public.student_attendance a where a.school_id = p_school and a.attendance_date = v_from;
    return jsonb_build_object('kind', 'morning', 'school_day', v_from, 'collected_from', v_from, 'collected_to', p_today - 1,
      'collected', v_cur, 'payments', v_count, 'attendance', v_att, 'fees', v_out);
  end if;

  select coalesce(sum(amount) filter (where (recorded_at at time zone 'Africa/Nairobi')::date between p_today - 6 and p_today), 0),
         coalesce(sum(amount) filter (where (recorded_at at time zone 'Africa/Nairobi')::date between p_today - 13 and p_today - 7), 0)
    into v_cur, v_prev
    from public.payments
   where school_id = p_school and status in ('confirmed', 'recorded', 'unallocated')
     and recorded_at >= (p_today - 13)::timestamp at time zone 'Africa/Nairobi';
  select case when count(*) > 0 then round(count(*) filter (where status in ('present', 'late')) * 100.0 / count(*), 1) end
    into v_rate
    from public.student_attendance
   where school_id = p_school and attendance_date between p_today - 5 and p_today - 1;
  return jsonb_build_object('kind', 'saturday', 'week_from', p_today - 6, 'week_to', p_today,
    'collected', v_cur, 'previous_week', v_prev, 'attendance_rate_pct', v_rate, 'fees', v_out);
end
$function$;

-- Service role only. For every registered director whose school has BOTH flags on and whose briefing is due, records a
-- 'would_send' row (once per director per day) and returns it with the figures, for the caller to format. The figures
-- are returned, never stored. p_now is a parameter so tests can control the clock.
create or replace function public.director_briefing_evaluate(p_now timestamptz default now())
returns table (log_id uuid, school_id uuid, school_user_id uuid, phone text, kind text, payload jsonb)
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  n record;
  l record;
  s public.director_briefing_settings;
  v_today date := (p_now at time zone 'Africa/Nairobi')::date;
  v_time time := (p_now at time zone 'Africa/Nairobi')::time;
  v_dow integer := extract(isodow from (p_now at time zone 'Africa/Nairobi'))::int;
  v_kind text;
  v_id uuid;
begin
  if v_dow = 7 then
    return;
  end if;
  v_kind := case when v_dow = 6 then 'saturday' else 'morning' end;

  for n in select * from public.director_whatsapp_numbers where status = 'active' order by created_at loop
    select * into l from public.director_whatsapp_lookup(n.phone) limit 1;
    if not found or not public.school_has_feature_flag(l.school_id, 'feature.bot.director_briefing') then
      continue;
    end if;

    select * into s from public.director_briefing_settings where director_briefing_settings.school_id = l.school_id;
    if not found then
      s.morning_enabled := true; s.saturday_enabled := true; s.briefing_time := '07:00';
    end if;
    if (v_kind = 'morning' and not s.morning_enabled) or (v_kind = 'saturday' and not s.saturday_enabled) then
      continue;
    end if;
    -- only inside the 3-hour window from the briefing time
    if v_time < s.briefing_time or v_time >= s.briefing_time + interval '3 hours' then
      continue;
    end if;

    insert into public.director_briefing_log (school_id, school_user_id, kind, dedupe_key, created_at)
    values (l.school_id, l.school_user_id, v_kind, v_kind || ':' || v_today::text, p_now)
    on conflict on constraint director_briefing_log_once do nothing
    returning id into v_id;
    if v_id is not null then
      return query select v_id, l.school_id, l.school_user_id, n.phone, v_kind,
        public.director_briefing_payload(l.school_id, v_kind, v_today);
    end if;
  end loop;
end
$function$;

-- Service role only. Used by part 2 once real sending is approved: move a would_send row to sent or failed.
create or replace function public.director_briefing_mark(p_log_id uuid, p_status text)
returns boolean
language plpgsql
security definer
set search_path to 'public'
as $function$
begin
  if p_status not in ('sent', 'failed') then
    raise exception 'status must be sent or failed';
  end if;
  update public.director_briefing_log set status = p_status where id = p_log_id and status = 'would_send';
  return found;
end
$function$;

revoke all on function public.director_briefing_settings_get() from public, anon;
revoke all on function public.director_briefing_settings_save(boolean, boolean, time) from public, anon;
revoke all on function public.director_briefing_payload(uuid, text, date) from public, anon, authenticated, service_role;
revoke all on function public.director_briefing_evaluate(timestamptz) from public, anon, authenticated;
revoke all on function public.director_briefing_mark(uuid, text) from public, anon, authenticated;
grant execute on function public.director_briefing_settings_get() to authenticated, service_role;
grant execute on function public.director_briefing_settings_save(boolean, boolean, time) to authenticated, service_role;
grant execute on function public.director_briefing_evaluate(timestamptz) to service_role;
grant execute on function public.director_briefing_mark(uuid, text) to service_role;

-- Rollback: the flag is off, so nothing runs. To remove: drop the five functions and the two tables, delete the flag row.
