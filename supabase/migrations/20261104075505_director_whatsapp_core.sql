-- WP 3.3: ask-in-plain-words for directors over WhatsApp (database core).
-- ADDITIVE ONLY: one flag (off for every school), two new tables, new functions. No existing function,
-- table, policy, trigger, constraint or grant is touched. whatsapp_conversations / whatsapp_messages are not used:
-- director questions are logged in their own table so the guardian inbox never shows them.
--
-- Who may ask: an active school_owner, principal or deputy_principal who has registered their OWN WhatsApp number
-- (the number must equal the phone on their staff profile) and ticked an explicit opt-in. Answers are figures read
-- straight from the school's records by fixed queries; nothing is generated. A number that is also an active guardian
-- (role parent) at the same school is never answered as a director. group_admin (several schools) is NOT included:
-- multi-school routing belongs to WP 3.4.

insert into public.platform_feature_flags (key, label, description)
select 'feature.bot.director',
       'Director WhatsApp questions',
       'Lets a school owner, principal or deputy principal who registered their own WhatsApp number ask the bot for school figures (collections, outstanding fees, attendance, learner numbers). Off by default.'
where not exists (select 1 from public.platform_feature_flags where lower(key) = 'feature.bot.director');

-- Kenyan number -> '+254XXXXXXXXX', or null when it is not a valid Kenyan mobile format.
create or replace function public.director_normalize_phone(p text)
returns text
language sql
immutable
set search_path to 'public'
as $$
  select case
    when s.d ~ '^0[0-9]{9}$' then '+254' || substr(s.d, 2)
    when s.d ~ '^254[0-9]{9}$' then '+' || s.d
    when s.d ~ '^[17][0-9]{8}$' then '+254' || s.d
    else null
  end
  from (select regexp_replace(coalesce(p, ''), '[^0-9]', '', 'g') as d) s
$$;

create table if not exists public.director_whatsapp_numbers (
  id uuid primary key default gen_random_uuid(),
  school_id uuid not null references public.schools(id) on delete cascade,
  school_user_id uuid not null references public.school_users(id) on delete cascade,
  phone text not null check (phone ~ '^\+254[0-9]{9}$'),
  status text not null default 'active' check (status in ('active', 'revoked')),
  consent_text text not null,
  opted_in_at timestamptz not null default now(),
  revoked_at timestamptz,
  created_at timestamptz not null default now()
);
comment on table public.director_whatsapp_numbers is 'WP 3.3: a director''s own WhatsApp number, registered with explicit opt-in. Read only by SECURITY DEFINER functions.';
create unique index if not exists director_whatsapp_numbers_one_active_per_user on public.director_whatsapp_numbers (school_user_id) where status = 'active';
create unique index if not exists director_whatsapp_numbers_one_active_per_phone on public.director_whatsapp_numbers (phone) where status = 'active';

create table if not exists public.director_whatsapp_log (
  id uuid primary key default gen_random_uuid(),
  school_id uuid not null references public.schools(id) on delete cascade,
  school_user_id uuid not null references public.school_users(id) on delete cascade,
  topic text not null,
  outcome text not null check (outcome in ('answered', 'unknown_topic')),
  message_sid text,
  created_at timestamptz not null default now()
);
comment on table public.director_whatsapp_log is 'WP 3.3: one row per director question (topic only, never the figures). message_sid makes a Twilio retry a no-op.';
create unique index if not exists director_whatsapp_log_message_sid on public.director_whatsapp_log (message_sid) where message_sid is not null;
create index if not exists director_whatsapp_log_school_created on public.director_whatsapp_log (school_id, created_at desc);

-- No policies and no client grants: only the SECURITY DEFINER functions below touch these tables.
alter table public.director_whatsapp_numbers enable row level security;
alter table public.director_whatsapp_log enable row level security;
revoke all on public.director_whatsapp_numbers from anon, authenticated;
revoke all on public.director_whatsapp_log from anon, authenticated;

-- Director registers their own number. Expected problems come back as a status, not an exception.
create or replace function public.director_whatsapp_register(p_phone text, p_consent boolean)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_uid uuid := auth.uid();
  v_su record;
  v_phone text := public.director_normalize_phone(p_phone);
begin
  if v_uid is null then
    raise exception 'not signed in' using errcode = '42501';
  end if;
  select su.id, su.school_id, su.phone, r.name as role_name into v_su
    from public.school_users su join public.roles r on r.id = su.role_id
   where su.auth_user_id = v_uid and su.school_id = public.auth_school_id() and su.status = 'active'
   limit 1;
  if not found or v_su.role_name not in ('school_owner', 'principal', 'deputy_principal') then
    raise exception 'only a school owner, principal or deputy principal may register' using errcode = '42501';
  end if;
  if not public.school_has_feature_flag(v_su.school_id, 'feature.bot.director') then
    return jsonb_build_object('status', 'disabled');
  end if;
  if p_consent is distinct from true then
    return jsonb_build_object('status', 'consent_required');
  end if;
  if v_phone is null then
    return jsonb_build_object('status', 'invalid_phone');
  end if;
  if public.director_normalize_phone(v_su.phone) is distinct from v_phone then
    return jsonb_build_object('status', 'phone_mismatch');
  end if;
  if exists (
    select 1 from public.school_users g join public.roles gr on gr.id = g.role_id
     where g.school_id = v_su.school_id and gr.name = 'parent' and g.status = 'active'
       and public.director_normalize_phone(g.phone) = v_phone
  ) then
    return jsonb_build_object('status', 'phone_is_guardian');
  end if;

  update public.director_whatsapp_numbers set status = 'revoked', revoked_at = now()
   where school_user_id = v_su.id and status = 'active';
  begin
    insert into public.director_whatsapp_numbers (school_id, school_user_id, phone, consent_text)
    values (v_su.school_id, v_su.id, v_phone, 'I agree that EduCore may send my school''s figures to this WhatsApp number when I ask for them.');
  exception when unique_violation then
    return jsonb_build_object('status', 'phone_in_use');
  end;
  return jsonb_build_object('status', 'registered', 'phone_masked', '+254******' || right(v_phone, 3));
end
$$;

create or replace function public.director_whatsapp_revoke()
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $$
declare v_uid uuid := auth.uid(); v_n integer;
begin
  if v_uid is null then
    raise exception 'not signed in' using errcode = '42501';
  end if;
  update public.director_whatsapp_numbers n set status = 'revoked', revoked_at = now()
    from public.school_users su
   where n.school_user_id = su.id and su.auth_user_id = v_uid and su.school_id = public.auth_school_id() and n.status = 'active';
  get diagnostics v_n = row_count;
  return jsonb_build_object('status', case when v_n > 0 then 'revoked' else 'nothing_to_revoke' end);
end
$$;

create or replace function public.director_whatsapp_status()
returns jsonb
language plpgsql
stable
security definer
set search_path to 'public'
as $$
declare v_uid uuid := auth.uid(); v_su record; v_n record;
begin
  if v_uid is null then
    raise exception 'not signed in' using errcode = '42501';
  end if;
  select su.id, su.school_id, r.name as role_name into v_su
    from public.school_users su join public.roles r on r.id = su.role_id
   where su.auth_user_id = v_uid and su.school_id = public.auth_school_id() and su.status = 'active'
   limit 1;
  if not found or v_su.role_name not in ('school_owner', 'principal', 'deputy_principal')
     or not public.school_has_feature_flag(v_su.school_id, 'feature.bot.director') then
    return jsonb_build_object('eligible', false);
  end if;
  select phone, opted_in_at into v_n from public.director_whatsapp_numbers where school_user_id = v_su.id and status = 'active';
  if not found then
    return jsonb_build_object('eligible', true, 'registered', false);
  end if;
  return jsonb_build_object('eligible', true, 'registered', true, 'phone_masked', '+254******' || right(v_n.phone, 3), 'opted_in_at', v_n.opted_in_at);
end
$$;

-- Service role only (the webhook). Returns the one director a WhatsApp number belongs to, only while EVERYTHING still holds:
-- active registration, active staff user whose profile phone still equals it, allowed role, flag on, not also a guardian there.
create or replace function public.director_whatsapp_lookup(p_phone text)
returns table (school_id uuid, school_user_id uuid, role_name text)
language sql
stable
security definer
set search_path to 'public'
as $$
  select n.school_id, n.school_user_id, r.name
    from public.director_whatsapp_numbers n
    join public.school_users su on su.id = n.school_user_id and su.school_id = n.school_id
    join public.roles r on r.id = su.role_id
   where n.status = 'active'
     and n.phone = p_phone
     and su.status = 'active'
     and public.director_normalize_phone(su.phone) = n.phone
     and r.name in ('school_owner', 'principal', 'deputy_principal')
     and public.school_has_feature_flag(n.school_id, 'feature.bot.director')
     and not exists (
       select 1 from public.school_users g join public.roles gr on gr.id = g.role_id
        where g.school_id = n.school_id and gr.name = 'parent' and g.status = 'active'
          and public.director_normalize_phone(g.phone) = n.phone
     )
$$;

-- Service role only. Re-verifies the director, logs the question, returns figures for ONE fixed topic of ONE school.
create or replace function public.director_whatsapp_answer(p_phone text, p_topic text, p_message_sid text default null)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_l record;
  v_today date := (now() at time zone 'Africa/Nairobi')::date;
  v_data jsonb;
  v_topics text[] := array['collection_today', 'collection_week', 'outstanding', 'top_arrears', 'attendance_today', 'absentees_today', 'enrolment'];
begin
  select * into v_l from public.director_whatsapp_lookup(p_phone) limit 1;
  if not found then
    return jsonb_build_object('status', 'not_director');
  end if;

  begin
    insert into public.director_whatsapp_log (school_id, school_user_id, topic, outcome, message_sid)
    values (v_l.school_id, v_l.school_user_id, left(coalesce(p_topic, ''), 40),
            case when p_topic = any (v_topics) then 'answered' else 'unknown_topic' end, p_message_sid);
  exception when unique_violation then
    return jsonb_build_object('status', 'duplicate');
  end;

  if p_topic is null or not (p_topic = any (v_topics)) then
    return jsonb_build_object('status', 'unknown_topic');
  end if;

  if p_topic in ('collection_today', 'collection_week') then
    select jsonb_build_object(
             'total', coalesce(sum(amount), 0),
             'count', count(*),
             'by_method', coalesce((
               select jsonb_object_agg(method, amt) from (
                 select method, sum(amount) as amt from public.payments
                  where school_id = v_l.school_id and status in ('confirmed', 'recorded', 'unallocated')
                    and (recorded_at at time zone 'Africa/Nairobi')::date between case when p_topic = 'collection_week' then v_today - 6 else v_today end and v_today
                  group by method) t), '{}'::jsonb))
      into v_data
      from public.payments
     where school_id = v_l.school_id and status in ('confirmed', 'recorded', 'unallocated')
       and (recorded_at at time zone 'Africa/Nairobi')::date between case when p_topic = 'collection_week' then v_today - 6 else v_today end and v_today;
    v_data := v_data || jsonb_build_object('days', case when p_topic = 'collection_week' then 7 else 1 end);

  elsif p_topic = 'outstanding' then
    select jsonb_build_object(
             'outstanding', coalesce(sum(b.balance) filter (where b.balance > 0), 0),
             'learners_owing', count(*) filter (where b.balance > 0),
             'unallocated_received', (select coalesce(sum(amount), 0) from public.payments where school_id = v_l.school_id and status = 'unallocated'))
      into v_data
      from public.v_student_balances b join public.students s on s.id = b.student_id
     where b.school_id = v_l.school_id and s.status = 'active';

  elsif p_topic = 'top_arrears' then
    select jsonb_build_object('rows', coalesce(jsonb_agg(jsonb_build_object('name', t.nm, 'balance', t.balance) order by t.balance desc), '[]'::jsonb))
      into v_data
      from (
        select s.first_name || ' ' || left(s.last_name, 1) || '.' as nm, b.balance
          from public.v_student_balances b join public.students s on s.id = b.student_id
         where b.school_id = v_l.school_id and s.status = 'active' and b.balance > 0
         order by b.balance desc limit 5) t;

  elsif p_topic = 'attendance_today' then
    select jsonb_build_object(
             'active_learners', (select count(*) from public.students where school_id = v_l.school_id and status = 'active'),
             'marked', count(distinct a.student_id),
             'present', count(distinct a.student_id) filter (where a.status = 'present'),
             'late', count(distinct a.student_id) filter (where a.status = 'late'),
             'absent', count(distinct a.student_id) filter (where a.status = 'absent'))
      into v_data
      from public.student_attendance a
     where a.school_id = v_l.school_id and a.attendance_date = v_today;

  elsif p_topic = 'absentees_today' then
    select jsonb_build_object('total', count(*), 'names', coalesce(jsonb_agg(t.nm order by t.nm) filter (where t.rn <= 15), '[]'::jsonb))
      into v_data
      from (
        select s.first_name || ' ' || left(s.last_name, 1) || '.' as nm, row_number() over (order by s.first_name, s.last_name) as rn
          from public.student_attendance a join public.students s on s.id = a.student_id
         where a.school_id = v_l.school_id and a.attendance_date = v_today and a.status = 'absent') t;

  else -- enrolment
    select jsonb_build_object('active_learners', count(*)) into v_data
      from public.students where school_id = v_l.school_id and status = 'active';
  end if;

  return jsonb_build_object('status', 'ok', 'topic', p_topic, 'as_of', now(), 'data', v_data);
end
$$;

revoke all on function public.director_normalize_phone(text) from public, anon, authenticated;
revoke all on function public.director_whatsapp_register(text, boolean) from public, anon, authenticated;
revoke all on function public.director_whatsapp_revoke() from public, anon, authenticated;
revoke all on function public.director_whatsapp_status() from public, anon, authenticated;
revoke all on function public.director_whatsapp_lookup(text) from public, anon, authenticated;
revoke all on function public.director_whatsapp_answer(text, text, text) from public, anon, authenticated;
grant execute on function public.director_normalize_phone(text) to service_role;
grant execute on function public.director_whatsapp_register(text, boolean) to authenticated, service_role;
grant execute on function public.director_whatsapp_revoke() to authenticated, service_role;
grant execute on function public.director_whatsapp_status() to authenticated, service_role;
grant execute on function public.director_whatsapp_lookup(text) to service_role;
grant execute on function public.director_whatsapp_answer(text, text, text) to service_role;
