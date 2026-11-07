-- WP 3.4: multi-campus group digest for group_admin (database core). ADDITIVE ONLY, dark, DRY-RUN.
--
-- Adds one flag, three tables and functions. Nothing existing is touched. The WP 3.3 director layer stays school-scoped:
-- group_admin is registered here, in a separate table keyed to the GROUP, with its own consent text that names every school covered.
--   * one Saturday digest per registered group admin, a block per school (same figures as the WP 3.1 Saturday digest, produced by the
--     same director_briefing_payload()), in a window of 3 hours from 07:00 Africa/Nairobi;
--   * a school appears only if feature.bot.director_briefing is on for it AND its owner/principal/deputy has not opted it out of the group
--     digest (school-level consent beats group membership);
--   * DRY-RUN: group_digest_evaluate() writes 'would_send' rows and returns the payloads; nothing is sent. The log stores kind, key and
--     status, never figures.
-- Production reading on 7 Nov 2026: zero active group_admin accounts exist, so nothing can be registered or produced until one does.

insert into public.platform_feature_flags (key, label, description)
select 'feature.bot.group_digest',
       'Group admin WhatsApp Saturday digest',
       'A weekly Saturday digest across the schools of a group for a group admin who registered their own WhatsApp number. Each school must also have feature.bot.director_briefing on and must not have opted out. Dry-run only until templates and consent wording are approved. Off by default.'
where not exists (select 1 from public.platform_feature_flags where lower(key) = 'feature.bot.group_digest');

create table if not exists public.group_digest_numbers (
  id uuid primary key default gen_random_uuid(),
  school_group_id uuid not null references public.school_groups(id) on delete cascade,
  school_user_id uuid not null references public.school_users(id) on delete cascade,
  phone text not null check (phone ~ '^\+254[0-9]{9}$'),
  consent_text text not null,
  status text not null default 'active' check (status in ('active', 'revoked')),
  created_at timestamptz not null default now(),
  revoked_at timestamptz
);
comment on table public.group_digest_numbers is 'WP 3.4: a group admin''s own WhatsApp number and the consent wording shown (which names every school covered at that moment).';
create unique index if not exists group_digest_numbers_one_active on public.group_digest_numbers (school_user_id) where status = 'active';

create table if not exists public.group_digest_school_optouts (
  school_id uuid primary key references public.schools(id) on delete cascade,
  opted_out_by uuid references public.school_users(id) on delete set null,
  created_at timestamptz not null default now()
);
comment on table public.group_digest_school_optouts is 'WP 3.4: a school whose owner/principal opted it out of the group digest. A row means excluded.';

create table if not exists public.group_digest_log (
  id uuid primary key default gen_random_uuid(),
  school_group_id uuid not null references public.school_groups(id) on delete cascade,
  school_user_id uuid not null references public.school_users(id) on delete cascade,
  dedupe_key text not null check (char_length(dedupe_key) between 1 and 40),
  status text not null default 'would_send' check (status in ('would_send', 'sent', 'failed')),
  created_at timestamptz not null default now(),
  constraint group_digest_log_once unique (school_user_id, dedupe_key)
);
comment on table public.group_digest_log is 'WP 3.4: one row per group digest per group admin per Saturday (key and status only, never figures).';

alter table public.group_digest_numbers enable row level security;
alter table public.group_digest_school_optouts enable row level security;
alter table public.group_digest_log enable row level security;
revoke all on public.group_digest_numbers from public, anon, authenticated;
revoke all on public.group_digest_school_optouts from public, anon, authenticated;
revoke all on public.group_digest_log from public, anon, authenticated;

-- A group admin registers their OWN number (it must equal the phone on their profile). The consent text is built here from the
-- schools of the group at this moment, so the person is shown exactly which schools are covered. p_consent must be true.
create or replace function public.group_digest_register(p_phone text, p_consent boolean)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_group uuid := public.auth_group_id();
  v_su_id uuid; v_su_phone text;
  v_phone text := public.director_normalize_phone(p_phone);
  v_names text;
  v_text text;
begin
  select su.id, su.phone into v_su_id, v_su_phone from public.school_users su join public.roles r on r.id = su.role_id
   where su.auth_user_id = auth.uid() and su.status = 'active' and r.name = 'group_admin' limit 1;
  if v_group is null or v_su_id is null then
    raise exception 'only a group admin may register for the group digest' using errcode = '42501';
  end if;
  if not exists (select 1 from public.schools s where s.school_group_id = v_group
                  and public.school_has_feature_flag(s.id, 'feature.bot.group_digest')) then
    return jsonb_build_object('status', 'disabled');
  end if;
  if p_consent is distinct from true then
    return jsonb_build_object('status', 'consent_required');
  end if;
  if v_phone is null then
    return jsonb_build_object('status', 'invalid_phone');
  end if;
  if public.director_normalize_phone(v_su_phone) is distinct from v_phone then
    return jsonb_build_object('status', 'phone_mismatch');
  end if;

  select string_agg(s.name, ', ' order by s.name) into v_names from public.schools s where s.school_group_id = v_group;
  v_text := 'I agree to receive a weekly Saturday summary on WhatsApp at this number covering these schools: ' || coalesce(v_names, '') ||
            '. It shows collections, attendance rate and outstanding fees per school. I can stop at any time.';

  update public.group_digest_numbers set status = 'revoked', revoked_at = now() where school_user_id = v_su_id and status = 'active';
  insert into public.group_digest_numbers (school_group_id, school_user_id, phone, consent_text)
  values (v_group, v_su_id, v_phone, v_text);
  return jsonb_build_object('status', 'registered', 'phone_masked', substr(v_phone, 1, 4) || '******' || right(v_phone, 3));
end
$function$;

create or replace function public.group_digest_revoke()
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_su uuid;
begin
  select su.id into v_su from public.school_users su join public.roles r on r.id = su.role_id
   where su.auth_user_id = auth.uid() and su.status = 'active' and r.name = 'group_admin' limit 1;
  if v_su is null then
    raise exception 'only a group admin may change the group digest' using errcode = '42501';
  end if;
  update public.group_digest_numbers set status = 'revoked', revoked_at = now() where school_user_id = v_su and status = 'active';
  return jsonb_build_object('status', case when found then 'revoked' else 'not_registered' end);
end
$function$;

create or replace function public.group_digest_status()
returns jsonb
language plpgsql
stable
security definer
set search_path to 'public'
as $function$
declare
  v_su uuid;
  n public.group_digest_numbers;
begin
  select su.id into v_su from public.school_users su join public.roles r on r.id = su.role_id
   where su.auth_user_id = auth.uid() and su.status = 'active' and r.name = 'group_admin' limit 1;
  if v_su is null then
    return jsonb_build_object('eligible', false);
  end if;
  select * into n from public.group_digest_numbers where school_user_id = v_su and status = 'active';
  if not found then
    return jsonb_build_object('eligible', true, 'registered', false);
  end if;
  return jsonb_build_object('eligible', true, 'registered', true, 'phone_masked', substr(n.phone, 1, 4) || '******' || right(n.phone, 3));
end
$function$;

-- A school's owner, principal or deputy opts the school in or out of the group digest (school-level consent beats group membership).
create or replace function public.group_digest_school_optout_set(p_opt_out boolean)
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
    raise exception 'only a school owner, principal or deputy principal may change this' using errcode = '42501';
  end if;
  if p_opt_out is true then
    insert into public.group_digest_school_optouts (school_id, opted_out_by) values (v_school, v_su) on conflict (school_id) do nothing;
  else
    delete from public.group_digest_school_optouts where school_id = v_school;
  end if;
  return jsonb_build_object('status', 'saved', 'opted_out', p_opt_out is true);
end
$function$;

-- Service role only. Every Saturday inside 07:00-10:00 Nairobi, for each active registered group admin, records one 'would_send' row
-- and returns the digest: one block per qualifying school (school name + the WP 3.1 Saturday payload). A group with no qualifying
-- school produces nothing. p_now is a parameter so tests can control the clock.
create or replace function public.group_digest_evaluate(p_now timestamptz default now())
returns table (log_id uuid, school_group_id uuid, school_user_id uuid, phone text, payload jsonb)
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_today date := (p_now at time zone 'Africa/Nairobi')::date;
  v_time time := (p_now at time zone 'Africa/Nairobi')::time;
  v_dow integer := extract(isodow from (p_now at time zone 'Africa/Nairobi'))::int;
  n record;
  v_blocks jsonb;
  v_id uuid;
begin
  if v_dow <> 6 or v_time < time '07:00' or v_time >= time '10:00' then
    return;
  end if;

  for n in
    select gn.id as number_id, gn.school_group_id as gid, gn.school_user_id as suid, gn.phone as ph
      from public.group_digest_numbers gn
      join public.school_users su on su.id = gn.school_user_id and su.status = 'active' and su.school_group_id = gn.school_group_id
      join public.roles r on r.id = su.role_id and r.name = 'group_admin'
     where gn.status = 'active'
       and public.director_normalize_phone(su.phone) = gn.phone
     order by gn.created_at
  loop
    select jsonb_agg(jsonb_build_object('school', s.name, 'figures', public.director_briefing_payload(s.id, 'saturday', v_today)) order by s.name)
      into v_blocks
      from public.schools s
     where s.school_group_id = n.gid
       and public.school_has_feature_flag(s.id, 'feature.bot.group_digest')
       and public.school_has_feature_flag(s.id, 'feature.bot.director_briefing')
       and not exists (select 1 from public.group_digest_school_optouts o where o.school_id = s.id);
    if v_blocks is null then
      continue;
    end if;

    v_id := null;
    insert into public.group_digest_log (school_group_id, school_user_id, dedupe_key, created_at)
    values (n.gid, n.suid, 'group-saturday:' || v_today::text, p_now)
    on conflict on constraint group_digest_log_once do nothing
    returning id into v_id;
    if v_id is not null then
      return query select v_id, n.gid, n.suid, n.ph, jsonb_build_object('kind', 'group_saturday', 'schools', v_blocks);
    end if;
  end loop;
end
$function$;

create or replace function public.group_digest_mark(p_log_id uuid, p_status text)
returns boolean
language plpgsql
security definer
set search_path to 'public'
as $function$
begin
  if p_status not in ('sent', 'failed') then
    raise exception 'status must be sent or failed';
  end if;
  update public.group_digest_log set status = p_status where id = p_log_id and status = 'would_send';
  return found;
end
$function$;

revoke all on function public.group_digest_register(text, boolean) from public, anon;
revoke all on function public.group_digest_revoke() from public, anon;
revoke all on function public.group_digest_status() from public, anon;
revoke all on function public.group_digest_school_optout_set(boolean) from public, anon;
revoke all on function public.group_digest_evaluate(timestamptz) from public, anon, authenticated;
revoke all on function public.group_digest_mark(uuid, text) from public, anon, authenticated;
grant execute on function public.group_digest_register(text, boolean) to authenticated, service_role;
grant execute on function public.group_digest_revoke() to authenticated, service_role;
grant execute on function public.group_digest_status() to authenticated, service_role;
grant execute on function public.group_digest_school_optout_set(boolean) to authenticated, service_role;
grant execute on function public.group_digest_evaluate(timestamptz) to service_role;
grant execute on function public.group_digest_mark(uuid, text) to service_role;

-- Rollback: flag off everywhere, nothing registered. To remove: drop the six functions and the three tables, delete the flag row.
