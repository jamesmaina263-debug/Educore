-- ============================================================================
-- Announcements -- PA-07: scheduled/future-dated publish
--
-- A draft announcement can be given a scheduled_at time instead of being
-- published immediately. A Vercel Cron sweep (see
-- src/app/api/cron/announcements/route.ts, added alongside this migration)
-- calls publish_due_scheduled_announcements() every 15 minutes, which
-- publishes anything whose time has arrived using the exact same
-- scope-resolution logic as publish_announcement -- refactored out into
-- resolve_and_insert_announcement_recipients() so the two entry points
-- (a human clicking Publish, and the cron sweep) can't drift apart.
--
-- create_announcement gains a p_scheduled_at parameter -- another signature
-- change, so the 8-arg PA-05 overload is dropped first, same as PA-05 itself
-- dropped the original 7-arg one.
-- ============================================================================

alter table announcements add column scheduled_at timestamptz;

alter table announcements add constraint announcements_scheduled_at_check
  check (scheduled_at is null or status = 'draft' or published_at is not null);
-- (a published/withdrawn row can still carry the scheduled_at it was
-- originally given, for display -- "was scheduled for X, published at Y" --
-- the constraint just forbids scheduled_at on a row that's neither draft
-- nor has ever been published, which can't happen anyway given the state
-- machine, but keeps the invariant explicit rather than assumed.)

create index idx_announcements_scheduled_pending on announcements(scheduled_at)
  where status = 'draft' and scheduled_at is not null;

comment on column announcements.scheduled_at is
  'PA-07: when set on a draft, publish_due_scheduled_announcements() (Vercel Cron, every 15 min) publishes it automatically once this time has passed. Publishing manually via publish_announcement() before then still works and simply pre-empts the schedule.';

-- ----------------------------------------------------------------------------
-- resolve_and_insert_announcement_recipients: the recipient-snapshot logic
-- extracted verbatim from publish_announcement/the PA-05 update to it, so
-- both the human-triggered publish path and the cron sweep share one
-- implementation. Returns the number of recipient rows inserted.
-- ----------------------------------------------------------------------------

create or replace function public.resolve_and_insert_announcement_recipients(p_id uuid)
returns integer
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_a public.announcements;
  v_recipient_count int;
begin
  select * into v_a from public.announcements where id = p_id;
  if v_a.id is null then
    raise exception 'announcement not found';
  end if;

  if v_a.scope = 'whole_school' then
    insert into public.announcement_recipients (announcement_id, guardian_user_id)
    select p_id, sg.guardian_user_id
    from public.student_guardians sg
    join public.students s on s.id = sg.student_id
    join public.school_users su on su.id = sg.guardian_user_id
    where s.school_id = v_a.school_id and s.status = 'active' and su.status = 'active'
    on conflict do nothing;

  elsif v_a.scope = 'grade' then
    insert into public.announcement_recipients (announcement_id, guardian_user_id)
    select p_id, sg.guardian_user_id
    from public.student_guardians sg
    join public.students s on s.id = sg.student_id
    join public.streams st on st.id = s.current_class_id
    join public.school_users su on su.id = sg.guardian_user_id
    where st.class_id = v_a.target_class_id and s.school_id = v_a.school_id
      and s.status = 'active' and su.status = 'active'
    on conflict do nothing;

  elsif v_a.scope = 'class' then
    insert into public.announcement_recipients (announcement_id, guardian_user_id)
    select p_id, sg.guardian_user_id
    from public.student_guardians sg
    join public.students s on s.id = sg.student_id
    join public.school_users su on su.id = sg.guardian_user_id
    where s.current_class_id = v_a.target_stream_id and s.school_id = v_a.school_id
      and s.status = 'active' and su.status = 'active'
    on conflict do nothing;

  elsif v_a.scope = 'student' then
    insert into public.announcement_recipients (announcement_id, guardian_user_id)
    select p_id, sg.guardian_user_id
    from public.student_guardians sg
    join public.school_users su on su.id = sg.guardian_user_id
    where sg.student_id = v_a.target_student_id and su.status = 'active'
    on conflict do nothing;

  elsif v_a.scope = 'boarding_house' then
    insert into public.announcement_recipients (announcement_id, guardian_user_id)
    select p_id, sg.guardian_user_id
    from public.hostel_allocations ha
    join public.hostel_rooms hr on hr.id = ha.hostel_room_id
    left join public.dormitories d on d.id = hr.dormitory_id
    join public.students s on s.id = ha.student_id
    join public.student_guardians sg on sg.student_id = s.id
    join public.school_users su on su.id = sg.guardian_user_id
    where ha.status = 'active'
      and coalesce(hr.house_id, d.house_id) = v_a.target_house_id
      and s.school_id = v_a.school_id and s.status = 'active' and su.status = 'active'
    on conflict do nothing;
  end if;

  get diagnostics v_recipient_count = row_count;
  return v_recipient_count;
end;
$$;

revoke all on function public.resolve_and_insert_announcement_recipients(uuid) from public, anon, authenticated;

-- ----------------------------------------------------------------------------
-- publish_announcement: unchanged behaviour, now calls the shared resolver.
-- ----------------------------------------------------------------------------

create or replace function public.publish_announcement(p_id uuid)
returns public.announcements
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_caller uuid := auth_school_user_id();
  v_school_id uuid := auth_school_id();
  v_a public.announcements;
  v_recipient_count int;
begin
  if v_caller is null or v_school_id is null then
    raise exception 'no active school session';
  end if;

  select * into v_a from public.announcements where id = p_id and school_id = v_school_id;
  if v_a.id is null then
    raise exception 'announcement not found';
  end if;
  if v_a.status <> 'draft' then
    raise exception 'only a draft announcement can be published';
  end if;
  if v_a.created_by <> v_caller and not auth_has_permission('announcements.publish') then
    raise exception 'insufficient permissions to publish this announcement';
  end if;

  v_recipient_count := public.resolve_and_insert_announcement_recipients(p_id);
  if v_recipient_count = 0 then
    raise exception 'no active guardians found for this announcement''s audience -- nothing to publish to';
  end if;

  update public.announcements
  set status = 'published', published_by = v_caller, published_at = now()
  where id = p_id
  returning * into v_a;

  return v_a;
end;
$$;

revoke all on function public.publish_announcement(uuid) from public, anon;
grant execute on function public.publish_announcement(uuid) to authenticated;

-- ----------------------------------------------------------------------------
-- publish_due_scheduled_announcements: service_role only (Vercel Cron).
-- A draft with no active guardians in its audience at sweep time is left
-- alone rather than erroring the whole sweep -- unlike the interactive path
-- (where an empty audience is almost certainly the publisher's own mistake
-- and should block immediately), a scheduled announcement might legitimately
-- have zero recipients right now and gain some before its time if the school
-- is mid-enrolment; it will simply be tried again on the next 15-minute
-- sweep. Returns how many were actually published this run.
-- ----------------------------------------------------------------------------

create or replace function public.publish_due_scheduled_announcements()
returns integer
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_a record;
  v_recipient_count int;
  v_published int := 0;
begin
  if auth.role() <> 'service_role' then
    raise exception 'publish_due_scheduled_announcements is a system-only function';
  end if;

  for v_a in
    select id from public.announcements
    where status = 'draft' and scheduled_at is not null and scheduled_at <= now()
    order by scheduled_at
  loop
    v_recipient_count := public.resolve_and_insert_announcement_recipients(v_a.id);
    if v_recipient_count > 0 then
      update public.announcements
      set status = 'published', published_at = now()
      where id = v_a.id;
      v_published := v_published + 1;
    end if;
  end loop;

  return v_published;
end;
$$;

revoke all on function public.publish_due_scheduled_announcements() from public, anon, authenticated;

-- ----------------------------------------------------------------------------
-- create_announcement: adds p_scheduled_at. If set, it must be strictly in
-- the future (a "scheduled" time in the past is just a slow way of saying
-- "publish now", and would otherwise sit as an unpublished draft until the
-- next cron tick gives it a confusing few-minutes-late publish time).
-- ----------------------------------------------------------------------------

drop function if exists public.create_announcement(text, text, text, text, uuid, uuid, uuid, uuid);

create or replace function public.create_announcement(
  p_title text,
  p_body text,
  p_scope text,
  p_urgency text default 'normal',
  p_target_class_id uuid default null,
  p_target_stream_id uuid default null,
  p_target_student_id uuid default null,
  p_target_house_id uuid default null,
  p_scheduled_at timestamptz default null
)
returns public.announcements
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_school_id uuid := auth_school_id();
  v_caller uuid := auth_school_user_id();
  v_announcement public.announcements;
  v_is_own_stream boolean := false;
  v_is_own_house boolean := false;
begin
  if v_school_id is null or v_caller is null then
    raise exception 'no active school session';
  end if;

  if p_title is null or btrim(p_title) = '' then
    raise exception 'title is required';
  end if;
  if p_body is null or btrim(p_body) = '' then
    raise exception 'message body is required';
  end if;
  if p_urgency not in ('normal', 'action_required', 'urgent') then
    raise exception 'invalid urgency: %', p_urgency;
  end if;
  if p_scope not in ('whole_school', 'grade', 'class', 'student', 'boarding_house') then
    raise exception 'invalid scope: %', p_scope;
  end if;
  if p_scheduled_at is not null and p_scheduled_at <= now() then
    raise exception 'scheduled_at must be in the future';
  end if;

  if p_scope in ('whole_school', 'grade') then
    if not auth_has_permission('announcements.publish') then
      raise exception 'insufficient permissions: announcements.publish required for % announcements', p_scope;
    end if;
    if p_scope = 'grade' and p_target_class_id is null then
      raise exception 'target_class_id is required for grade scope';
    end if;
    if p_scope = 'whole_school' and (p_target_class_id is not null or p_target_stream_id is not null or p_target_student_id is not null or p_target_house_id is not null) then
      raise exception 'whole_school scope must not set any target_id';
    end if;
    if p_target_class_id is not null and not exists (
      select 1 from public.classes where id = p_target_class_id and school_id = v_school_id
    ) then
      raise exception 'grade not found in this school';
    end if;

  elsif p_scope = 'class' then
    if p_target_stream_id is null then
      raise exception 'target_stream_id is required for class scope';
    end if;
    select exists (
      select 1 from public.streams
      where id = p_target_stream_id and school_id = v_school_id and class_teacher_id = v_caller
    ) into v_is_own_stream;
    if not v_is_own_stream and not auth_has_permission('announcements.publish') then
      raise exception 'insufficient permissions: only the class teacher of this stream or announcements.publish may publish here';
    end if;
    if not exists (select 1 from public.streams where id = p_target_stream_id and school_id = v_school_id) then
      raise exception 'class not found in this school';
    end if;

  elsif p_scope = 'student' then
    if p_target_student_id is null then
      raise exception 'target_student_id is required for student scope';
    end if;
    if not exists (select 1 from public.students where id = p_target_student_id and school_id = v_school_id) then
      raise exception 'student not found in this school';
    end if;
    if not auth_user_is_class_teacher_of(p_target_student_id) and not auth_has_permission('announcements.publish') then
      raise exception 'insufficient permissions: only the class teacher of this student or announcements.publish may publish here';
    end if;

  elsif p_scope = 'boarding_house' then
    if p_target_house_id is null then
      raise exception 'target_house_id is required for boarding_house scope';
    end if;
    select exists (
      select 1 from public.boarding_houses
      where id = p_target_house_id and school_id = v_school_id and v_caller in (master_id, assistant_id)
    ) into v_is_own_house;
    if not v_is_own_house and not auth_has_permission('announcements.publish') then
      raise exception 'insufficient permissions: only this house''s master/assistant or announcements.publish may publish here';
    end if;
    if not exists (select 1 from public.boarding_houses where id = p_target_house_id and school_id = v_school_id) then
      raise exception 'house not found in this school';
    end if;
  end if;

  insert into public.announcements (
    school_id, created_by, title, body, urgency, scope,
    target_class_id, target_stream_id, target_student_id, target_house_id,
    scheduled_at
  )
  values (
    v_school_id, v_caller, btrim(p_title), p_body, p_urgency, p_scope,
    p_target_class_id, p_target_stream_id, p_target_student_id, p_target_house_id,
    p_scheduled_at
  )
  returning * into v_announcement;

  return v_announcement;
end;
$$;

revoke all on function public.create_announcement(text, text, text, text, uuid, uuid, uuid, uuid, timestamptz) from public, anon;
grant execute on function public.create_announcement(text, text, text, text, uuid, uuid, uuid, uuid, timestamptz) to authenticated;
