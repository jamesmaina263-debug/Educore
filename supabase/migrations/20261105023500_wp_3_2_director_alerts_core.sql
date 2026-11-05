-- WP 3.2 Director alerts (1/2): database core. ADDITIVE ONLY, flag off for every school.
--
-- Adds one flag, two tables and functions. No existing function, table, policy, trigger, constraint or grant is
-- touched. Reuses the WP 3.3 consent layer: an alert can only go to a director who registered their OWN WhatsApp
-- number with an explicit opt-in (director_whatsapp_numbers) and who still passes director_whatsapp_lookup().
-- The existing 3-consecutive-day absence SMS is not changed.
--
-- Three alert types, all from fixed queries (nothing generated):
--   large_payment  one confirmed/recorded/unallocated payment >= a threshold, in the last 24 hours
--   collection_drop  collections of the last 7 days are >= X% below the 7 days before them (checked from 08:00)
--   low_attendance  today's attendance rate is below a floor, once enough learners are marked (10:00 to 16:00)
--
-- v1 is DRY-RUN: director_alerts_evaluate() only writes 'would_send' rows to the log. Nothing is sent to anyone by this
-- migration. The log stores the alert type and a dedupe key, never the figures.

insert into public.platform_feature_flags (key, label, description)
select 'feature.bot.director_alerts',
       'Director WhatsApp alerts',
       'Large-payment, collection-drop and low-attendance alerts to directors who registered their own WhatsApp number. Needs feature.bot.director. Dry-run only until templates are approved. Off by default.'
where not exists (select 1 from public.platform_feature_flags where lower(key) = 'feature.bot.director_alerts');

create table if not exists public.director_alert_settings (
  school_id uuid primary key references public.schools(id) on delete cascade,
  large_payment_enabled boolean not null default true,
  large_payment_threshold numeric(12, 2) not null default 50000 check (large_payment_threshold between 1000 and 10000000),
  collection_drop_enabled boolean not null default true,
  collection_drop_pct integer not null default 30 check (collection_drop_pct between 5 and 90),
  low_attendance_enabled boolean not null default true,
  attendance_floor_pct integer not null default 85 check (attendance_floor_pct between 30 and 99),
  attendance_min_marked_pct integer not null default 80 check (attendance_min_marked_pct between 50 and 100),
  quiet_start time not null default '20:00',
  quiet_end time not null default '07:00',
  max_per_day integer not null default 3 check (max_per_day between 1 and 10),
  updated_by uuid references public.school_users(id) on delete set null,
  updated_at timestamptz not null default now()
);
comment on table public.director_alert_settings is 'WP 3.2: per-school alert thresholds. Defaults apply when a school has no row. Written only by director_alert_settings_save().';

create table if not exists public.director_alert_log (
  id uuid primary key default gen_random_uuid(),
  school_id uuid not null references public.schools(id) on delete cascade,
  school_user_id uuid not null references public.school_users(id) on delete cascade,
  alert_type text not null check (alert_type in ('large_payment', 'collection_drop', 'low_attendance')),
  dedupe_key text not null check (char_length(dedupe_key) between 1 and 80),
  status text not null default 'would_send' check (status in ('would_send', 'sent', 'failed')),
  created_at timestamptz not null default now(),
  unique (school_user_id, dedupe_key)
);
comment on table public.director_alert_log is 'WP 3.2: one row per alert per director (type and key only, never the figures). The unique key makes an alert fire once.';
create index if not exists director_alert_log_school_created on public.director_alert_log (school_id, created_at desc);

-- No policies and no client grants: only the SECURITY DEFINER functions below touch these tables.
alter table public.director_alert_settings enable row level security;
alter table public.director_alert_log enable row level security;
revoke all on public.director_alert_settings from public, anon, authenticated;
revoke all on public.director_alert_log from public, anon, authenticated;

-- Directors (owner, principal, deputy) read the settings of their own school.
create or replace function public.director_alert_settings_get()
returns jsonb
language plpgsql
stable
security definer
set search_path to 'public'
as $function$
declare
  v_school uuid := public.auth_school_id();
  v_role text;
  s public.director_alert_settings;
begin
  select r.name into v_role from public.school_users su join public.roles r on r.id = su.role_id
   where su.auth_user_id = auth.uid() and su.school_id = v_school and su.status = 'active' limit 1;
  if v_school is null or v_role is null or v_role not in ('school_owner', 'principal', 'deputy_principal')
     or not public.school_has_feature_flag(v_school, 'feature.bot.director_alerts') then
    return jsonb_build_object('eligible', false);
  end if;
  select * into s from public.director_alert_settings where school_id = v_school;
  if not found then
    s.large_payment_enabled := true; s.large_payment_threshold := 50000; s.collection_drop_enabled := true;
    s.collection_drop_pct := 30; s.low_attendance_enabled := true; s.attendance_floor_pct := 85;
    s.attendance_min_marked_pct := 80; s.quiet_start := '20:00'; s.quiet_end := '07:00'; s.max_per_day := 3;
  end if;
  return jsonb_build_object('eligible', true,
    'large_payment_enabled', s.large_payment_enabled, 'large_payment_threshold', s.large_payment_threshold,
    'collection_drop_enabled', s.collection_drop_enabled, 'collection_drop_pct', s.collection_drop_pct,
    'low_attendance_enabled', s.low_attendance_enabled, 'attendance_floor_pct', s.attendance_floor_pct,
    'attendance_min_marked_pct', s.attendance_min_marked_pct,
    'quiet_start', s.quiet_start, 'quiet_end', s.quiet_end, 'max_per_day', s.max_per_day);
end
$function$;

create or replace function public.director_alert_settings_save(
  p_large_payment_enabled boolean,
  p_large_payment_threshold numeric,
  p_collection_drop_enabled boolean,
  p_collection_drop_pct integer,
  p_low_attendance_enabled boolean,
  p_attendance_floor_pct integer,
  p_attendance_min_marked_pct integer,
  p_quiet_start time,
  p_quiet_end time,
  p_max_per_day integer
)
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
    raise exception 'only a school owner, principal or deputy principal may change alert settings' using errcode = '42501';
  end if;
  if not public.school_has_feature_flag(v_school, 'feature.bot.director_alerts') then
    return jsonb_build_object('status', 'disabled');
  end if;
  -- Values outside the table's CHECK ranges raise check_violation, which the caller shows as "invalid value".
  insert into public.director_alert_settings as d (school_id, large_payment_enabled, large_payment_threshold, collection_drop_enabled,
    collection_drop_pct, low_attendance_enabled, attendance_floor_pct, attendance_min_marked_pct, quiet_start, quiet_end, max_per_day, updated_by, updated_at)
  values (v_school, p_large_payment_enabled, p_large_payment_threshold, p_collection_drop_enabled, p_collection_drop_pct,
    p_low_attendance_enabled, p_attendance_floor_pct, p_attendance_min_marked_pct, p_quiet_start, p_quiet_end, p_max_per_day, v_su, now())
  on conflict (school_id) do update set
    large_payment_enabled = excluded.large_payment_enabled, large_payment_threshold = excluded.large_payment_threshold,
    collection_drop_enabled = excluded.collection_drop_enabled, collection_drop_pct = excluded.collection_drop_pct,
    low_attendance_enabled = excluded.low_attendance_enabled, attendance_floor_pct = excluded.attendance_floor_pct,
    attendance_min_marked_pct = excluded.attendance_min_marked_pct, quiet_start = excluded.quiet_start, quiet_end = excluded.quiet_end,
    max_per_day = excluded.max_per_day, updated_by = excluded.updated_by, updated_at = now();
  return jsonb_build_object('status', 'saved');
end
$function$;

-- Internal: record one alert for one director unless the daily cap is reached or it was already recorded.
-- Returns the new log id, or null when skipped. Not callable by anyone but other definer functions.
create or replace function public.director_alert_try_log(p_school uuid, p_user uuid, p_type text, p_key text, p_max integer, p_now timestamptz)
returns uuid
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_id uuid;
  v_today date := (p_now at time zone 'Africa/Nairobi')::date;
begin
  if (select count(*) from public.director_alert_log
       where school_user_id = p_user and status in ('would_send', 'sent')
         and (created_at at time zone 'Africa/Nairobi')::date = v_today) >= p_max then
    return null;
  end if;
  insert into public.director_alert_log (school_id, school_user_id, alert_type, dedupe_key, created_at)
  values (p_school, p_user, p_type, p_key, p_now)
  on conflict (school_user_id, dedupe_key) do nothing
  returning id into v_id;
  return v_id;
end
$function$;

-- Service role only. Looks at every registered director whose school has BOTH flags on, applies quiet hours and the
-- daily cap, records new alerts as 'would_send' and returns them (with the figures, for the caller to format). The
-- figures are returned, never stored. p_now is a parameter so tests can control the clock.
create or replace function public.director_alerts_evaluate(p_now timestamptz default now())
returns table (log_id uuid, school_id uuid, school_user_id uuid, phone text, alert_type text, payload jsonb)
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  n record;
  l record;
  s public.director_alert_settings;
  v_local timestamp := p_now at time zone 'Africa/Nairobi';
  v_today date := (p_now at time zone 'Africa/Nairobi')::date;
  v_time time := (p_now at time zone 'Africa/Nairobi')::time;
  v_quiet boolean;
  v_id uuid;
  p record;
  v_cur numeric; v_prev numeric; v_active integer; v_marked integer; v_ok integer;
begin
  for n in select * from public.director_whatsapp_numbers where status = 'active' order by created_at loop
    select * into l from public.director_whatsapp_lookup(n.phone) limit 1;
    if not found or not public.school_has_feature_flag(l.school_id, 'feature.bot.director_alerts') then
      continue;
    end if;

    select * into s from public.director_alert_settings where director_alert_settings.school_id = l.school_id;
    if not found then
      s.large_payment_enabled := true; s.large_payment_threshold := 50000; s.collection_drop_enabled := true;
      s.collection_drop_pct := 30; s.low_attendance_enabled := true; s.attendance_floor_pct := 85;
      s.attendance_min_marked_pct := 80; s.quiet_start := '20:00'; s.quiet_end := '07:00'; s.max_per_day := 3;
    end if;

    v_quiet := case when s.quiet_start > s.quiet_end then (v_time >= s.quiet_start or v_time < s.quiet_end)
                    else (v_time >= s.quiet_start and v_time < s.quiet_end) end;
    if v_quiet then
      continue;
    end if;

    -- 1. large payment (each payment alerts once per director)
    if s.large_payment_enabled then
      for p in
        select pay.id, pay.amount, pay.method from public.payments pay
         where pay.school_id = l.school_id and pay.status in ('confirmed', 'recorded', 'unallocated')
           and pay.amount >= s.large_payment_threshold and pay.recorded_at > p_now - interval '24 hours'
           and pay.recorded_at <= p_now
           and not exists (select 1 from public.director_alert_log x where x.school_user_id = l.school_user_id and x.dedupe_key = 'pay:' || pay.id::text)
         order by pay.recorded_at limit 3
      loop
        v_id := public.director_alert_try_log(l.school_id, l.school_user_id, 'large_payment', 'pay:' || p.id::text, s.max_per_day, p_now);
        if v_id is not null then
          return query select v_id, l.school_id, l.school_user_id, n.phone, 'large_payment'::text,
            jsonb_build_object('amount', p.amount, 'method', p.method);
        end if;
      end loop;
    end if;

    -- 2. collection drop: last 7 complete days vs the 7 before, once a day from 08:00
    if s.collection_drop_enabled and v_time >= time '08:00' then
      select coalesce(sum(amount) filter (where (recorded_at at time zone 'Africa/Nairobi')::date between v_today - 7 and v_today - 1), 0),
             coalesce(sum(amount) filter (where (recorded_at at time zone 'Africa/Nairobi')::date between v_today - 14 and v_today - 8), 0)
        into v_cur, v_prev
        from public.payments
       where payments.school_id = l.school_id and status in ('confirmed', 'recorded', 'unallocated')
         and recorded_at >= p_now - interval '16 days';
      if v_prev > 0 and ((v_prev - v_cur) / v_prev * 100) >= s.collection_drop_pct then
        v_id := public.director_alert_try_log(l.school_id, l.school_user_id, 'collection_drop', 'drop:' || v_today::text, s.max_per_day, p_now);
        if v_id is not null then
          return query select v_id, l.school_id, l.school_user_id, n.phone, 'collection_drop'::text,
            jsonb_build_object('current', v_cur, 'previous', v_prev, 'drop_pct', round((v_prev - v_cur) / v_prev * 100));
        end if;
      end if;
    end if;

    -- 3. low attendance today, only once enough learners are marked
    if s.low_attendance_enabled and v_time >= time '10:00' and v_time < time '16:00' then
      select count(*) into v_active from public.students where students.school_id = l.school_id and status = 'active';
      select count(distinct a.student_id), count(distinct a.student_id) filter (where a.status in ('present', 'late'))
        into v_marked, v_ok
        from public.student_attendance a where a.school_id = l.school_id and a.attendance_date = v_today;
      if v_active > 0 and v_marked > 0 and (v_marked * 100.0 / v_active) >= s.attendance_min_marked_pct
         and (v_ok * 100.0 / v_marked) < s.attendance_floor_pct then
        v_id := public.director_alert_try_log(l.school_id, l.school_user_id, 'low_attendance', 'att:' || v_today::text, s.max_per_day, p_now);
        if v_id is not null then
          return query select v_id, l.school_id, l.school_user_id, n.phone, 'low_attendance'::text,
            jsonb_build_object('rate_pct', round(v_ok * 100.0 / v_marked), 'marked', v_marked, 'active_learners', v_active);
        end if;
      end if;
    end if;
  end loop;
end
$function$;

-- Service role only. Used by part 2 once real sending is approved: move a would_send row to sent or failed.
create or replace function public.director_alert_mark(p_log_id uuid, p_status text)
returns boolean
language plpgsql
security definer
set search_path to 'public'
as $function$
begin
  if p_status not in ('sent', 'failed') then
    raise exception 'status must be sent or failed';
  end if;
  update public.director_alert_log set status = p_status where id = p_log_id and status = 'would_send';
  return found;
end
$function$;

revoke all on function public.director_alert_settings_get() from public, anon;
revoke all on function public.director_alert_settings_save(boolean, numeric, boolean, integer, boolean, integer, integer, time, time, integer) from public, anon;
revoke all on function public.director_alert_try_log(uuid, uuid, text, text, integer, timestamptz) from public, anon, authenticated, service_role;
revoke all on function public.director_alerts_evaluate(timestamptz) from public, anon, authenticated;
revoke all on function public.director_alert_mark(uuid, text) from public, anon, authenticated;
grant execute on function public.director_alert_settings_get() to authenticated, service_role;
grant execute on function public.director_alert_settings_save(boolean, numeric, boolean, integer, boolean, integer, integer, time, time, integer) to authenticated, service_role;
grant execute on function public.director_alerts_evaluate(timestamptz) to service_role;
grant execute on function public.director_alert_mark(uuid, text) to service_role;

-- Rollback: the flag is off, so nothing runs. To remove: drop the five functions and the two tables, delete the flag row.
