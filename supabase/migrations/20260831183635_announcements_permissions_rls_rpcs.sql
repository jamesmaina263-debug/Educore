-- ============================================================================
-- Announcements -- Phase 0: permissions, RLS, RPCs
--
-- Write model: same as Connect -- no INSERT/UPDATE/DELETE policy for
-- `authenticated` on announcements or announcement_recipients. Every write
-- goes through one of the SECURITY DEFINER RPCs below.
--
-- One new permission key:
--   announcements.publish  -- whole-school/grade/class/student publishing +
--                              withdrawal, by default: school_owner,
--                              principal, deputy_principal (mirrors
--                              connect.read_any's leadership set)
-- Class teachers need no permission key to publish to their OWN stream or
-- OWN student -- that's ownership-checked in the RPCs below (mirrors
-- connect.create's class-teacher-of-this-student check), not grant-based.
-- A class teacher cannot publish whole_school or grade scope, or to a
-- stream/student that isn't theirs -- that always requires
-- announcements.publish (PA-12: restrict publishing to authorised staff).
-- ============================================================================

insert into role_permissions (role_id, school_id, permission_key, allowed)
select r.id, null, 'announcements.publish', true
from roles r
where r.name in ('school_owner', 'principal', 'deputy_principal')
on conflict do nothing;

-- ----------------------------------------------------------------------------
-- RLS: SELECT only. No write policies -- see header.
-- ----------------------------------------------------------------------------

create policy announcements_select on announcements
for select
using (
  auth_is_super_admin()
  or ((school_id = auth_school_id()) and auth_has_permission('announcements.publish'))
  or created_by = auth_school_user_id()
  or (
    status = 'published'
    and exists (
      select 1 from announcement_recipients ar
      where ar.announcement_id = announcements.id
        and ar.guardian_user_id = auth_school_user_id()
    )
  )
);

create policy announcement_recipients_select on announcement_recipients
for select
using (
  guardian_user_id = auth_school_user_id()
  or exists (
    select 1 from announcements a
    where a.id = announcement_recipients.announcement_id
      and (
        auth_is_super_admin()
        or ((a.school_id = auth_school_id()) and auth_has_permission('announcements.publish'))
        or a.created_by = auth_school_user_id()
      )
  )
);

-- ----------------------------------------------------------------------------
-- create_announcement: creates a draft. No recipients yet -- those are
-- snapshotted at publish time by publish_announcement.
-- ----------------------------------------------------------------------------

create or replace function public.create_announcement(
  p_title text,
  p_body text,
  p_scope text,
  p_urgency text default 'normal',
  p_target_class_id uuid default null,
  p_target_stream_id uuid default null,
  p_target_student_id uuid default null
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
  if p_scope not in ('whole_school', 'grade', 'class', 'student') then
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
    if p_scope = 'whole_school' and (p_target_class_id is not null or p_target_stream_id is not null or p_target_student_id is not null) then
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
  end if;

  insert into public.announcements (
    school_id, created_by, title, body, urgency, scope,
    target_class_id, target_stream_id, target_student_id
  )
  values (
    v_school_id, v_caller, btrim(p_title), p_body, p_urgency, p_scope,
    p_target_class_id, p_target_stream_id, p_target_student_id
  )
  returning * into v_announcement;

  return v_announcement;
end;
$$;

revoke all on function public.create_announcement(text, text, text, text, uuid, uuid, uuid) from public, anon;
grant execute on function public.create_announcement(text, text, text, text, uuid, uuid, uuid) to authenticated;

-- ----------------------------------------------------------------------------
-- publish_announcement: only the creator or an announcements.publish holder.
-- Populates announcement_recipients from student_guardians for the
-- announcement's scope. Zero recipients is a hard error, same reasoning as
-- create_connect_item -- publishing to nobody is a data problem, not a
-- legitimate empty broadcast.
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

-- ----------------------------------------------------------------------------
-- withdraw_announcement (PA-11): only a published announcement can be
-- withdrawn. Recipients rows are kept (not deleted) so read/ack history
-- survives the withdrawal, per PA-13's audit requirement.
-- ----------------------------------------------------------------------------

create or replace function public.withdraw_announcement(p_id uuid, p_reason text default null)
returns public.announcements
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_caller uuid := auth_school_user_id();
  v_school_id uuid := auth_school_id();
  v_a public.announcements;
begin
  if v_caller is null or v_school_id is null then
    raise exception 'no active school session';
  end if;

  select * into v_a from public.announcements where id = p_id and school_id = v_school_id;
  if v_a.id is null then
    raise exception 'announcement not found';
  end if;
  if v_a.status <> 'published' then
    raise exception 'only a published announcement can be withdrawn';
  end if;
  if v_a.created_by <> v_caller and not auth_has_permission('announcements.publish') then
    raise exception 'insufficient permissions to withdraw this announcement';
  end if;

  update public.announcements
  set status = 'withdrawn', withdrawn_by = v_caller, withdrawn_at = now(), withdrawal_reason = p_reason
  where id = p_id
  returning * into v_a;

  return v_a;
end;
$$;

revoke all on function public.withdraw_announcement(uuid, text) from public, anon;
grant execute on function public.withdraw_announcement(uuid, text) to authenticated;

-- ----------------------------------------------------------------------------
-- mark_announcement_read / acknowledge_announcement: guardian-side, both
-- idempotent no-ops on repeat calls (mirrors mark_connect_item_read).
-- ----------------------------------------------------------------------------

create or replace function public.mark_announcement_read(p_id uuid)
returns void
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_caller uuid := auth_school_user_id();
begin
  if v_caller is null then
    raise exception 'no active school session';
  end if;

  if not exists (
    select 1 from public.announcement_recipients
    where announcement_id = p_id and guardian_user_id = v_caller
  ) then
    raise exception 'not a recipient of this announcement';
  end if;

  update public.announcement_recipients
  set read_at = now()
  where announcement_id = p_id and guardian_user_id = v_caller and read_at is null;
end;
$$;

revoke all on function public.mark_announcement_read(uuid) from public, anon;
grant execute on function public.mark_announcement_read(uuid) to authenticated;

create or replace function public.acknowledge_announcement(p_id uuid)
returns void
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_caller uuid := auth_school_user_id();
  v_status text;
begin
  if v_caller is null then
    raise exception 'no active school session';
  end if;

  if not exists (
    select 1 from public.announcement_recipients
    where announcement_id = p_id and guardian_user_id = v_caller
  ) then
    raise exception 'not a recipient of this announcement';
  end if;

  select status into v_status from public.announcements where id = p_id;
  if v_status is null then
    raise exception 'announcement not found';
  end if;
  if v_status = 'withdrawn' then
    raise exception 'this announcement has been withdrawn';
  end if;

  update public.announcement_recipients
  set read_at = coalesce(read_at, now()), acknowledged_at = now()
  where announcement_id = p_id and guardian_user_id = v_caller;
end;
$$;

revoke all on function public.acknowledge_announcement(uuid) from public, anon;
grant execute on function public.acknowledge_announcement(uuid) to authenticated;
