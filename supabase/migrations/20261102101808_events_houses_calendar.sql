-- Phase 8.6 (1/2): school events calendar and competition houses. Additive only; ships dark.
--
-- * New flag feature.school.events_calendar (catalog entry, enabled for nobody).
-- * New tables: school_houses (competition/sports houses, NOT boarding_houses), student_house_memberships
--   (one house per learner) and school_events (calendar entries, optionally tied to one house).
-- * RLS on every table. Reads need the flag on for the caller's own school. There are NO direct write
--   policies: every change goes through the SECURITY DEFINER functions below, which check
--   academics.write, the flag and same-school ownership themselves.
-- * Nothing existing is touched: boarding_houses, announcements, terms and every existing function,
--   policy, trigger and grant are unchanged. No messages are sent by anything here.
-- Rollback: switch the flag off (reads return nothing, functions refuse). Nothing else depends on these objects.

-- 1. Flag catalog entry.
insert into public.platform_feature_flags (key, label, description)
select 'feature.school.events_calendar',
       'Events and houses calendar',
       'School events calendar plus competition houses (separate from boarding houses). Off by default.'
where not exists (
  select 1 from public.platform_feature_flags where lower(key) = 'feature.school.events_calendar'
);

-- 2. Competition houses.
create table if not exists public.school_houses (
  id uuid primary key default gen_random_uuid(),
  school_id uuid not null references public.schools(id) on delete cascade,
  name text not null check (char_length(btrim(name)) between 1 and 60),
  colour text not null default '#6b7280' check (colour ~ '^#[0-9a-fA-F]{6}$'),
  status text not null default 'active' check (status in ('active', 'archived')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
comment on table public.school_houses is
  'Competition/sports houses (e.g. Red House). Unrelated to boarding_houses. Written only by save_school_house().';
create unique index if not exists school_houses_school_name_uniq
  on public.school_houses (school_id, lower(btrim(name)));
alter table public.school_houses enable row level security;
drop policy if exists school_houses_select on public.school_houses;
create policy school_houses_select on public.school_houses for select
  using (
    auth_is_super_admin()
    or (school_id = auth_school_id() and public.my_school_has_feature_flag('feature.school.events_calendar'))
  );

-- 3. Learner to house (one house per learner).
create table if not exists public.student_house_memberships (
  student_id uuid primary key references public.students(id) on delete cascade,
  school_id uuid not null references public.schools(id) on delete cascade,
  house_id uuid not null references public.school_houses(id) on delete cascade,
  assigned_by uuid references public.school_users(id) on delete set null,
  assigned_at timestamptz not null default now()
);
comment on table public.student_house_memberships is
  'One competition house per learner. Written only by assign_student_house().';
create index if not exists student_house_memberships_house on public.student_house_memberships (house_id);
alter table public.student_house_memberships enable row level security;
drop policy if exists student_house_memberships_select on public.student_house_memberships;
create policy student_house_memberships_select on public.student_house_memberships for select
  using (
    auth_is_super_admin()
    or (
      school_id = auth_school_id()
      and auth_has_permission('academics.read')
      and public.my_school_has_feature_flag('feature.school.events_calendar')
    )
  );

-- 4. Events.
create table if not exists public.school_events (
  id uuid primary key default gen_random_uuid(),
  school_id uuid not null references public.schools(id) on delete cascade,
  title text not null check (char_length(btrim(title)) between 1 and 150),
  description text check (description is null or char_length(description) <= 2000),
  category text not null default 'other'
    check (category in ('academic', 'sports', 'cultural', 'meeting', 'holiday', 'trip', 'exam', 'other')),
  starts_on date not null,
  ends_on date not null,
  start_time time,
  end_time time,
  location text check (location is null or char_length(location) <= 150),
  house_id uuid references public.school_houses(id) on delete set null,
  audience text not null default 'everyone' check (audience in ('everyone', 'staff_only')),
  status text not null default 'scheduled' check (status in ('scheduled', 'cancelled')),
  cancel_reason text check (cancel_reason is null or char_length(cancel_reason) <= 500),
  created_by uuid references public.school_users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint school_events_dates_ok check (ends_on >= starts_on),
  constraint school_events_times_ok check (
    (start_time is null and end_time is null)
    or (start_time is not null and (end_time is null or starts_on <> ends_on or end_time > start_time))
  )
);
comment on table public.school_events is
  'School calendar entries. Never deleted: cancel_school_event() sets status = cancelled. Written only by save_school_event() / cancel_school_event().';
create index if not exists school_events_school_start on public.school_events (school_id, starts_on);
create index if not exists school_events_house on public.school_events (house_id) where house_id is not null;
alter table public.school_events enable row level security;
drop policy if exists school_events_select on public.school_events;
create policy school_events_select on public.school_events for select
  using (
    auth_is_super_admin()
    or (
      school_id = auth_school_id()
      and public.my_school_has_feature_flag('feature.school.events_calendar')
      and (audience = 'everyone' or auth_has_permission('academics.read'))
    )
  );

-- 5. Save a house (create when p_id is null).
create or replace function public.save_school_house(
  p_id uuid,
  p_name text,
  p_colour text,
  p_status text
) returns uuid
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_school uuid := auth_school_id();
  v_id uuid;
begin
  if v_school is null or not auth_has_permission('academics.write') then
    raise exception 'Not authorized to manage houses.' using errcode = '42501';
  end if;
  if not public.school_has_feature_flag(v_school, 'feature.school.events_calendar') then
    raise exception 'The events and houses calendar is not enabled for this school.' using errcode = '55000';
  end if;
  if p_name is null or char_length(btrim(p_name)) not between 1 and 60
     or p_colour is null or p_colour !~ '^#[0-9a-fA-F]{6}$'
     or p_status is null or p_status not in ('active', 'archived') then
    raise exception 'Invalid house details.' using errcode = '22023';
  end if;

  if p_id is null then
    insert into public.school_houses (school_id, name, colour, status)
    values (v_school, btrim(p_name), p_colour, p_status)
    returning id into v_id;
  else
    update public.school_houses
       set name = btrim(p_name), colour = p_colour, status = p_status, updated_at = now()
     where id = p_id and school_id = v_school
    returning id into v_id;
    if v_id is null then
      raise exception 'House not found.' using errcode = 'P0002';
    end if;
  end if;
  return v_id;
end;
$$;
revoke all on function public.save_school_house(uuid, text, text, text) from public, anon;
grant execute on function public.save_school_house(uuid, text, text, text) to authenticated;

-- 6. Put a learner in a house; p_house_id null removes the learner from their house.
create or replace function public.assign_student_house(
  p_student_id uuid,
  p_house_id uuid
) returns void
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_school uuid := auth_school_id();
  v_actor uuid;
begin
  if v_school is null or not auth_has_permission('academics.write') then
    raise exception 'Not authorized to assign houses.' using errcode = '42501';
  end if;
  if not public.school_has_feature_flag(v_school, 'feature.school.events_calendar') then
    raise exception 'The events and houses calendar is not enabled for this school.' using errcode = '55000';
  end if;
  if p_student_id is null
     or not exists (select 1 from public.students where id = p_student_id and school_id = v_school) then
    raise exception 'Learner not found.' using errcode = 'P0002';
  end if;

  if p_house_id is null then
    delete from public.student_house_memberships where student_id = p_student_id and school_id = v_school;
    return;
  end if;

  if not exists (
    select 1 from public.school_houses where id = p_house_id and school_id = v_school and status = 'active'
  ) then
    raise exception 'House not found or archived.' using errcode = 'P0002';
  end if;

  v_actor := auth_school_user_id();
  insert into public.student_house_memberships as m (student_id, school_id, house_id, assigned_by)
  values (p_student_id, v_school, p_house_id, v_actor)
  on conflict (student_id) do update
    set house_id = excluded.house_id, assigned_by = excluded.assigned_by, assigned_at = now();
end;
$$;
revoke all on function public.assign_student_house(uuid, uuid) from public, anon;
grant execute on function public.assign_student_house(uuid, uuid) to authenticated;

-- 7. Save an event (create when p_id is null).
create or replace function public.save_school_event(
  p_id uuid,
  p_title text,
  p_description text,
  p_category text,
  p_starts_on date,
  p_ends_on date,
  p_start_time time,
  p_end_time time,
  p_location text,
  p_house_id uuid,
  p_audience text
) returns uuid
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_school uuid := auth_school_id();
  v_id uuid;
begin
  if v_school is null or not auth_has_permission('academics.write') then
    raise exception 'Not authorized to manage events.' using errcode = '42501';
  end if;
  if not public.school_has_feature_flag(v_school, 'feature.school.events_calendar') then
    raise exception 'The events and houses calendar is not enabled for this school.' using errcode = '55000';
  end if;
  if p_title is null or char_length(btrim(p_title)) not between 1 and 150
     or p_category is null or p_category not in ('academic', 'sports', 'cultural', 'meeting', 'holiday', 'trip', 'exam', 'other')
     or p_audience is null or p_audience not in ('everyone', 'staff_only')
     or p_starts_on is null or p_ends_on is null or p_ends_on < p_starts_on
     or (p_start_time is null and p_end_time is not null)
     or (p_end_time is not null and p_starts_on = p_ends_on and p_end_time <= p_start_time)
     or (p_description is not null and char_length(p_description) > 2000)
     or (p_location is not null and char_length(p_location) > 150) then
    raise exception 'Invalid event details.' using errcode = '22023';
  end if;
  if p_house_id is not null and not exists (
    select 1 from public.school_houses where id = p_house_id and school_id = v_school
  ) then
    raise exception 'House not found.' using errcode = 'P0002';
  end if;

  if p_id is null then
    insert into public.school_events (
      school_id, title, description, category, starts_on, ends_on, start_time, end_time,
      location, house_id, audience, created_by
    ) values (
      v_school, btrim(p_title), nullif(btrim(coalesce(p_description, '')), ''), p_category, p_starts_on, p_ends_on,
      p_start_time, p_end_time, nullif(btrim(coalesce(p_location, '')), ''), p_house_id, p_audience,
      auth_school_user_id()
    ) returning id into v_id;
  else
    update public.school_events
       set title = btrim(p_title),
           description = nullif(btrim(coalesce(p_description, '')), ''),
           category = p_category, starts_on = p_starts_on, ends_on = p_ends_on,
           start_time = p_start_time, end_time = p_end_time,
           location = nullif(btrim(coalesce(p_location, '')), ''),
           house_id = p_house_id, audience = p_audience, updated_at = now()
     where id = p_id and school_id = v_school and status = 'scheduled'
    returning id into v_id;
    if v_id is null then
      raise exception 'Event not found or already cancelled.' using errcode = 'P0002';
    end if;
  end if;
  return v_id;
end;
$$;
revoke all on function public.save_school_event(uuid, text, text, text, date, date, time, time, text, uuid, text) from public, anon;
grant execute on function public.save_school_event(uuid, text, text, text, date, date, time, time, text, uuid, text) to authenticated;

-- 8. Cancel an event (status change; the row is kept).
create or replace function public.cancel_school_event(
  p_id uuid,
  p_reason text
) returns void
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_school uuid := auth_school_id();
  v_id uuid;
begin
  if v_school is null or not auth_has_permission('academics.write') then
    raise exception 'Not authorized to cancel events.' using errcode = '42501';
  end if;
  if not public.school_has_feature_flag(v_school, 'feature.school.events_calendar') then
    raise exception 'The events and houses calendar is not enabled for this school.' using errcode = '55000';
  end if;
  if p_reason is not null and char_length(p_reason) > 500 then
    raise exception 'Invalid cancellation reason.' using errcode = '22023';
  end if;
  update public.school_events
     set status = 'cancelled', cancel_reason = nullif(btrim(coalesce(p_reason, '')), ''), updated_at = now()
   where id = p_id and school_id = v_school and status = 'scheduled'
  returning id into v_id;
  if v_id is null then
    raise exception 'Event not found or already cancelled.' using errcode = 'P0002';
  end if;
end;
$$;
revoke all on function public.cancel_school_event(uuid, text) from public, anon;
grant execute on function public.cancel_school_event(uuid, text) to authenticated;
