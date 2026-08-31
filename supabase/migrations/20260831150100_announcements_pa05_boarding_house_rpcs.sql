-- ============================================================================
-- Announcements -- PA-05: boarding-house targeting (RPCs)
--
-- create_announcement gains a p_target_house_id parameter -- signature
-- change, so the old 7-arg overload is dropped first (same pattern as
-- multi_item_medical_only_transfers.sql) rather than left as a stale
-- ambiguous overload.
--
-- Authorization for boarding_house scope: announcements.publish (leadership)
-- OR the house's own master/assistant (boarding_houses.master_id /
-- assistant_id) -- mirrors the class-teacher-owns-their-stream pattern from
-- the base migration, at house-master granularity instead.
--
-- Recipient resolution: a boarder's house is derived from their active
-- hostel_allocations row -> hostel_rooms, which attaches to a house either
-- directly (hostel_rooms.house_id) or via a dormitory
-- (hostel_rooms.dormitory_id -> dormitories.house_id). A room with neither
-- set (flat/no-house-concept room) is simply not reachable by this scope.
-- ============================================================================

drop function if exists public.create_announcement(text, text, text, text, uuid, uuid, uuid);

create or replace function public.create_announcement(
  p_title text,
  p_body text,
  p_scope text,
  p_urgency text default 'normal',
  p_target_class_id uuid default null,
  p_target_stream_id uuid default null,
  p_target_student_id uuid default null,
  p_target_house_id uuid default null
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

  -- Authorization, per scope.
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
    target_class_id, target_stream_id, target_student_id, target_house_id
  )
  values (
    v_school_id, v_caller, btrim(p_title), p_body, p_urgency, p_scope,
    p_target_class_id, p_target_stream_id, p_target_student_id, p_target_house_id
  )
  returning * into v_announcement;

  return v_announcement;
end;
$$;

revoke all on function public.create_announcement(text, text, text, text, uuid, uuid, uuid, uuid) from public, anon;
grant execute on function public.create_announcement(text, text, text, text, uuid, uuid, uuid, uuid) to authenticated;

-- ----------------------------------------------------------------------------
-- publish_announcement: same signature, adds a boarding_house recipient
-- branch.
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

  if v_a.scope = 'whole_school' then
    insert into public.announcement_recipients (announcement_id, guardian_user_id)
    select p_id, sg.guardian_user_id
    from public.student_guardians sg
    join public.students s on s.id = sg.student_id
    join public.school_users su on su.id = sg.guardian_user_id
    where s.school_id = v_school_id and s.status = 'active' and su.status = 'active'
    on conflict do nothing;

  elsif v_a.scope = 'grade' then
    insert into public.announcement_recipients (announcement_id, guardian_user_id)
    select p_id, sg.guardian_user_id
    from public.student_guardians sg
    join public.students s on s.id = sg.student_id
    join public.streams st on st.id = s.current_class_id
    join public.school_users su on su.id = sg.guardian_user_id
    where st.class_id = v_a.target_class_id and s.school_id = v_school_id
      and s.status = 'active' and su.status = 'active'
    on conflict do nothing;

  elsif v_a.scope = 'class' then
    insert into public.announcement_recipients (announcement_id, guardian_user_id)
    select p_id, sg.guardian_user_id
    from public.student_guardians sg
    join public.students s on s.id = sg.student_id
    join public.school_users su on su.id = sg.guardian_user_id
    where s.current_class_id = v_a.target_stream_id and s.school_id = v_school_id
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
      and s.school_id = v_school_id and s.status = 'active' and su.status = 'active'
    on conflict do nothing;
  end if;

  get diagnostics v_recipient_count = row_count;
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
