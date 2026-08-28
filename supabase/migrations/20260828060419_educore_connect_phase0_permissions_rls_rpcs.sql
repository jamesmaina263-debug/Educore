-- ============================================================================
-- Educore Connect -- Phase 0: permissions, RLS, RPCs
--
-- Write model: connect_items / connect_item_recipients / connect_item_events
-- have RLS enabled with SELECT-only policies. There is no INSERT/UPDATE/DELETE
-- policy for `authenticated` on any of the three tables -- every write goes
-- through one of the SECURITY DEFINER RPCs below (same no-client-write-policy
-- pattern already used for payments/invoices/fee_waivers in this codebase).
-- This is what makes "no UPDATE grant/policy at all for guardians" and
-- "RLS independently blocks the underlying writes even if the UI were
-- bypassed" true by construction, not by convention.
--
-- Three new permission keys:
--   connect.create     -- class teachers only, by default (authorship is
--                          explicitly class-teacher-only this phase)
--   connect.resolve    -- class teachers only, by default (same scoping;
--                          resolve_connect_item further restricts to the
--                          item's own creator, not just any connect.resolve
--                          holder -- narrowest correct behaviour given the
--                          plan never asks for cross-teacher resolution)
--   connect.read_any   -- leadership visibility, mirrors discipline.read_any
--                          / finance.read precedent (school_owner, principal,
--                          deputy_principal)
-- Guardian access needs no permission key -- it's identity-based via
-- auth_user_id_is_guardian_of(), same as invoices/payments/pt_meeting_bookings.
-- ============================================================================

insert into role_permissions (role_id, school_id, permission_key, allowed)
select r.id, null, 'connect.create', true
from roles r
where r.name = 'class_teacher'
on conflict do nothing;

insert into role_permissions (role_id, school_id, permission_key, allowed)
select r.id, null, 'connect.resolve', true
from roles r
where r.name = 'class_teacher'
on conflict do nothing;

insert into role_permissions (role_id, school_id, permission_key, allowed)
select r.id, null, 'connect.read_any', true
from roles r
where r.name in ('school_owner', 'principal', 'deputy_principal')
on conflict do nothing;

-- ----------------------------------------------------------------------------
-- RLS: SELECT only. No write policies -- see header.
-- ----------------------------------------------------------------------------

create policy connect_items_select on connect_items
for select
using (
  auth_is_super_admin()
  or ((school_id = auth_school_id()) and auth_has_permission('connect.read_any'))
  or created_by = auth_school_user_id()
  or auth_user_id_is_guardian_of(student_id)
);

create policy connect_item_recipients_select on connect_item_recipients
for select
using (
  guardian_user_id = auth_school_user_id()
  or exists (
    select 1 from connect_items ci
    where ci.id = connect_item_recipients.item_id
      and (
        auth_is_super_admin()
        or ((ci.school_id = auth_school_id()) and auth_has_permission('connect.read_any'))
        or ci.created_by = auth_school_user_id()
      )
  )
);

create policy connect_item_events_select on connect_item_events
for select
using (
  exists (
    select 1 from connect_item_recipients cir
    where cir.item_id = connect_item_events.item_id
      and cir.guardian_user_id = auth_school_user_id()
  )
  or exists (
    select 1 from connect_items ci
    where ci.id = connect_item_events.item_id
      and (
        auth_is_super_admin()
        or ((ci.school_id = auth_school_id()) and auth_has_permission('connect.read_any'))
        or ci.created_by = auth_school_user_id()
      )
  )
);

-- ----------------------------------------------------------------------------
-- create_connect_item: the only way a connect_items row (and its recipient
-- snapshot) comes into existence. Single function = atomic; a partial
-- failure (e.g. mid-way through inserting recipients) rolls back the whole
-- item rather than leaving it recipient-less.
-- ----------------------------------------------------------------------------

create or replace function public.create_connect_item(
  p_student_id uuid,
  p_category text,
  p_title text,
  p_body text,
  p_due_date date default null,
  p_requires_response boolean default false
)
returns public.connect_items
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_school_id uuid := auth_school_id();
  v_caller uuid := auth_school_user_id();
  v_item public.connect_items;
  v_recipient_count int;
begin
  if v_school_id is null or v_caller is null then
    raise exception 'no active school session';
  end if;

  if not auth_has_permission('connect.create') then
    raise exception 'insufficient permissions: connect.create required';
  end if;

  if not exists (select 1 from students s where s.id = p_student_id and s.school_id = v_school_id) then
    raise exception 'student not found in this school';
  end if;

  if not auth_user_is_class_teacher_of(p_student_id) then
    raise exception 'only the class teacher of this student may create a Connect item for them';
  end if;

  if p_category not in ('request', 'academic', 'attendance') then
    raise exception 'invalid category: %', p_category;
  end if;

  if p_title is null or btrim(p_title) = '' then
    raise exception 'title is required';
  end if;

  if p_body is null or btrim(p_body) = '' then
    raise exception 'message body is required';
  end if;

  insert into public.connect_items (school_id, student_id, created_by, category, title, body, due_date, requires_response)
  values (v_school_id, p_student_id, v_caller, p_category, btrim(p_title), p_body, p_due_date, coalesce(p_requires_response, false))
  returning * into v_item;

  insert into public.connect_item_recipients (item_id, guardian_user_id)
  select v_item.id, sg.guardian_user_id
  from public.student_guardians sg
  join public.school_users su on su.id = sg.guardian_user_id
  where sg.student_id = p_student_id
    and su.status = 'active';

  get diagnostics v_recipient_count = row_count;
  if v_recipient_count = 0 then
    raise exception 'student has no active guardians on file -- cannot create a Connect item with no recipients';
  end if;

  return v_item;
end;
$$;

revoke all on function public.create_connect_item(uuid, text, text, text, date, boolean) from public, anon;
grant execute on function public.create_connect_item(uuid, text, text, text, date, boolean) to authenticated;

-- ----------------------------------------------------------------------------
-- mark_connect_item_read: idempotent -- re-opening an already-read item is a
-- silent no-op, but calling it as a non-recipient is a hard error (a UI bug,
-- not a legitimate no-op).
-- ----------------------------------------------------------------------------

create or replace function public.mark_connect_item_read(p_item_id uuid)
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
    select 1 from public.connect_item_recipients
    where item_id = p_item_id and guardian_user_id = v_caller
  ) then
    raise exception 'not a recipient of this item';
  end if;

  update public.connect_item_recipients
  set read_at = now()
  where item_id = p_item_id
    and guardian_user_id = v_caller
    and read_at is null;
end;
$$;

revoke all on function public.mark_connect_item_read(uuid) from public, anon;
grant execute on function public.mark_connect_item_read(uuid) to authenticated;

-- ----------------------------------------------------------------------------
-- acknowledge_connect_item
-- ----------------------------------------------------------------------------

create or replace function public.acknowledge_connect_item(p_item_id uuid)
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
    select 1 from public.connect_item_recipients
    where item_id = p_item_id and guardian_user_id = v_caller
  ) then
    raise exception 'not a recipient of this item';
  end if;

  select status into v_status from public.connect_items where id = p_item_id;
  if v_status is null then
    raise exception 'item not found';
  end if;
  if v_status = 'resolved' then
    raise exception 'this item has been resolved and no longer accepts guardian responses';
  end if;

  insert into public.connect_item_events (item_id, event_type, actor_role, actor_school_user_id)
  values (p_item_id, 'acknowledged', 'guardian', v_caller);
end;
$$;

revoke all on function public.acknowledge_connect_item(uuid) from public, anon;
grant execute on function public.acknowledge_connect_item(uuid) to authenticated;

-- ----------------------------------------------------------------------------
-- reply_connect_item: only when the item requires a response; rate-limited
-- via the existing generic increment_and_check_rate_limit() (5 replies per
-- 60 seconds per guardian -- not specified by the owner, flagged as an
-- assumption in the Phase 1 deliverables report, easy to tune later).
-- ----------------------------------------------------------------------------

create or replace function public.reply_connect_item(p_item_id uuid, p_body text)
returns void
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_caller uuid := auth_school_user_id();
  v_status text;
  v_requires_response boolean;
begin
  if v_caller is null then
    raise exception 'no active school session';
  end if;

  if p_body is null or btrim(p_body) = '' then
    raise exception 'reply body is required';
  end if;

  if not exists (
    select 1 from public.connect_item_recipients
    where item_id = p_item_id and guardian_user_id = v_caller
  ) then
    raise exception 'not a recipient of this item';
  end if;

  select status, requires_response into v_status, v_requires_response
  from public.connect_items where id = p_item_id;

  if v_status is null then
    raise exception 'item not found';
  end if;
  if v_status = 'resolved' then
    raise exception 'this item has been resolved and no longer accepts guardian responses';
  end if;
  if not v_requires_response then
    raise exception 'this item does not require a response';
  end if;

  if not public.increment_and_check_rate_limit('connect_reply:' || v_caller::text, 5, 60) then
    raise exception 'too many replies -- please wait a moment and try again';
  end if;

  insert into public.connect_item_events (item_id, event_type, actor_role, actor_school_user_id, body)
  values (p_item_id, 'replied', 'guardian', v_caller, p_body);
end;
$$;

revoke all on function public.reply_connect_item(uuid, text) from public, anon;
grant execute on function public.reply_connect_item(uuid, text) to authenticated;

-- ----------------------------------------------------------------------------
-- resolve_connect_item: restricted to the item's own creator holding
-- connect.resolve, not any connect.resolve holder in the school -- the plan
-- never asks for cross-teacher resolution, so this is the narrowest correct
-- behaviour (flagged per the plan's own instruction on deviations).
-- ----------------------------------------------------------------------------

create or replace function public.resolve_connect_item(p_item_id uuid)
returns void
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_caller uuid := auth_school_user_id();
  v_school_id uuid := auth_school_id();
  v_item public.connect_items;
begin
  if v_caller is null or v_school_id is null then
    raise exception 'no active school session';
  end if;

  if not auth_has_permission('connect.resolve') then
    raise exception 'insufficient permissions: connect.resolve required';
  end if;

  select * into v_item from public.connect_items
  where id = p_item_id and school_id = v_school_id;

  if v_item.id is null then
    raise exception 'item not found';
  end if;
  if v_item.created_by != v_caller then
    raise exception 'only the teacher who created this item may resolve it';
  end if;
  if v_item.status = 'resolved' then
    raise exception 'item is already resolved';
  end if;

  update public.connect_items
  set status = 'resolved', resolved_by = v_caller, resolved_at = now()
  where id = p_item_id;

  insert into public.connect_item_events (item_id, event_type, actor_role, actor_school_user_id, old_status, new_status)
  values (p_item_id, 'status_changed', 'teacher', v_caller, 'open', 'resolved');
end;
$$;

revoke all on function public.resolve_connect_item(uuid) from public, anon;
grant execute on function public.resolve_connect_item(uuid) to authenticated;
