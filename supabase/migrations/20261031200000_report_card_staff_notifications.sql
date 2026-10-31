-- In-app staff notifications for the report-card workflow.
--
-- Reuses the existing in-app notification system (notification_logs, channel 'in_app', read by the
-- topbar bell) and its existing primitive notify_school_user(), which already honours each user's
-- notification preferences. No new table. This adds only what that primitive can't do on its own:
--   * work out WHO should hear about a report-card event from real data, by effective permission;
--   * stay quiet: no notification when there is nothing to act on, none to the person who just acted,
--     and at most one UNREAD notification per recipient per event per place (the link), so a bulk
--     action or a run of single actions cannot flood the bell.
--
-- Events (the only report-card states that exist today; there is no separate "final approval" or
-- "return for correction" step in the data model):
--   ready_for_comments  cards generated, no comment yet            -> the stream's class teacher
--   awaiting_approval   AI-drafted comments waiting for approval   -> class teacher + approve-any holders
--   needs_reapproval    card reset by a mark corrected after       -> class teacher + approve-any holders
--                       approval (comment text kept)
--   approved            comments the caller just approved          -> the stream's class teacher, if
--                                                                     someone else approved them
-- Counts are read from report_cards here, never taken from the caller, so a caller cannot make
-- someone else's bell say something that is not true.
--
-- Rollback:
--   drop function if exists public.notify_report_card_event(text, uuid, uuid, uuid, uuid);
--   drop function if exists public._notify_report_card_once(uuid, text, text, text);
--   drop function if exists public.school_user_has_permission(uuid, text);

-- 1. Effective permission for ANY school user (auth_has_permission only answers for the caller).
--    Same precedence as auth_has_permission() / notify_users_with_permission(): per-user override,
--    then the school's role setting, then the global role default. Internal helper: not callable by
--    API roles.
create or replace function public.school_user_has_permission(p_school_user_id uuid, p_permission_key text)
returns boolean
language sql
stable
security definer
set search_path to 'public'
as $$
  select coalesce(
    (select coalesce(
        (select upo.allowed from user_permission_overrides upo
          where upo.school_user_id = su.id and upo.permission_key = p_permission_key),
        (select rp.allowed from role_permissions rp
          where rp.role_id = su.role_id and rp.school_id = su.school_id and rp.permission_key = p_permission_key),
        (select rp.allowed from role_permissions rp
          where rp.role_id = su.role_id and rp.school_id is null and rp.permission_key = p_permission_key),
        false)
     from school_users su
     where su.id = p_school_user_id and su.status = 'active'),
    false);
$$;

revoke all on function public.school_user_has_permission(uuid, text) from public, anon, authenticated;

-- 2. One unread notification per recipient per event per place. Delegates to notify_school_user().
create or replace function public._notify_report_card_once(p_recipient uuid, p_subject text, p_body text, p_url text)
returns boolean
language plpgsql
security definer
set search_path to 'public'
as $$
begin
  if exists (
    select 1 from notification_logs nl
    where nl.recipient_school_user_id = p_recipient
      and nl.channel = 'in_app'
      and nl.action_url = p_url
      and nl.subject = p_subject
      and nl.read_at is null
      and nl.dismissed_at is null
      and nl.created_at > now() - interval '14 days'
  ) then
    return false;
  end if;
  return notify_school_user(p_recipient, p_subject, p_body, p_url, 'other') is not null;
end;
$$;

revoke all on function public._notify_report_card_once(uuid, text, text, text) from public, anon, authenticated;

-- 3. The event function the app calls (best-effort) after the action that created the work.
--    Scope: exactly one of p_stream_id / p_student_id (that learner's stream) / p_class_id (every stream).
create or replace function public.notify_report_card_event(
  p_event text,
  p_exam_id uuid,
  p_class_id uuid default null,
  p_stream_id uuid default null,
  p_student_id uuid default null
)
returns integer
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_school uuid := auth_school_id();
  v_caller uuid := auth_school_user_id();
  v_caller_name text;
  v_exam_name text;
  v_sent integer := 0;
  v_notified uuid[] := '{}';
  v_classes uuid[] := '{}';
  v_stream record;
  v_admin record;
  v_class_name text;
  v_count integer;
  v_subject text;
  v_body text;
  v_url text;
  v_label text;
  v_plural text;
  v_verb text;
begin
  if v_school is null or v_caller is null then
    return 0;
  end if;
  if p_event not in ('ready_for_comments', 'awaiting_approval', 'needs_reapproval', 'approved') then
    raise exception 'Unknown report card event.';
  end if;
  -- Same gate as seeing report cards at all; the caller is already acting on them.
  if not auth_has_permission('exams.read') then
    return 0;
  end if;

  select btrim(name) into v_exam_name from exams where id = p_exam_id and school_id = v_school and status = 'closed';
  if v_exam_name is null then
    return 0;
  end if;
  select full_name into v_caller_name from school_users where id = v_caller;

  for v_stream in
    select st.id, st.name, st.class_id, st.class_teacher_id, c.name as class_name
    from streams st
    join classes c on c.id = st.class_id
    where c.school_id = v_school
      and st.id in (
        select p_stream_id where p_stream_id is not null
        union
        select s.current_class_id from students s where p_student_id is not null and s.id = p_student_id and s.school_id = v_school
        union
        select st2.id from streams st2 where p_class_id is not null and st2.class_id = p_class_id
      )
    order by c.name, st.name
  loop
    if not (v_stream.class_id = any(v_classes)) then
      v_classes := array_append(v_classes, v_stream.class_id);
    end if;

    -- Per-stream: the class teacher.
    select count(*) into v_count
    from report_cards rc
    join students s on s.id = rc.student_id and s.status = 'active'
    where rc.exam_id = p_exam_id
      and rc.class_id = v_stream.class_id
      and s.current_class_id = v_stream.id
      and case p_event
        when 'ready_for_comments' then rc.comment_source = 'none' and btrim(coalesce(rc.comment, '')) = ''
        when 'awaiting_approval' then rc.comment_source = 'ai'
        when 'needs_reapproval' then rc.comment_source = 'none' and btrim(coalesce(rc.comment, '')) <> ''
        else rc.comment_source in ('teacher_approved', 'teacher_written')
             and rc.approved_by is not distinct from v_caller
             and rc.approved_at > now() - interval '10 minutes'
      end;

    if v_count > 0
       and v_stream.class_teacher_id is not null
       and v_stream.class_teacher_id <> v_caller
       and exists (select 1 from school_users su where su.id = v_stream.class_teacher_id and su.school_id = v_school and su.status = 'active')
       and (p_event = 'approved'
            or school_user_has_permission(v_stream.class_teacher_id, 'report_cards.approve')
            or school_user_has_permission(v_stream.class_teacher_id, 'report_cards.approve_any'))
    then
      v_label := v_stream.class_name || ' ' || v_stream.name;
      v_plural := case when v_count = 1 then '' else 's' end;
      v_verb := case when v_count = 1 then 'is' else 'are' end;
      v_url := '/exams/report-cards?exam=' || p_exam_id || '&class=' || v_stream.class_id || '&stream=' || v_stream.id;
      if p_event = 'ready_for_comments' then
        v_subject := 'Report cards ready for comments';
        v_body := format('%s report card%s in %s (%s) %s ready for your comments.', v_count, v_plural, v_label, v_exam_name, v_verb);
      elsif p_event = 'awaiting_approval' then
        v_subject := 'Comments awaiting your approval';
        v_body := format('%s AI-drafted comment%s in %s (%s) %s waiting to be approved.', v_count, v_plural, v_label, v_exam_name, v_verb);
      elsif p_event = 'needs_reapproval' then
        v_subject := 'Comments need re-approval';
        v_body := format('%s report card%s in %s (%s) %s reset after a mark was corrected. The comment needs re-approval.', v_count, v_plural, v_label, v_exam_name, v_verb);
      else
        v_subject := 'Comments approved';
        v_body := format('%s approved %s comment%s in %s (%s).', coalesce(v_caller_name, 'A colleague'), v_count, v_plural, v_label, v_exam_name);
      end if;
      if _notify_report_card_once(v_stream.class_teacher_id, v_subject, v_body, v_url) then
        v_sent := v_sent + 1;
        v_notified := array_append(v_notified, v_stream.class_teacher_id);
      end if;
    end if;
  end loop;

  -- Per-class: people who can approve any stream (deputy principal / principal / school owner by
  -- default) hear once per class, not once per stream.
  if p_event in ('awaiting_approval', 'needs_reapproval') then
    for v_stream in
      select c.id as class_id, c.name as class_name from classes c where c.id = any(v_classes) order by c.name
    loop
      select count(*) into v_count
      from report_cards rc
      join students s on s.id = rc.student_id and s.status = 'active'
      join streams st on st.id = s.current_class_id and st.class_id = v_stream.class_id
      where rc.exam_id = p_exam_id
        and rc.class_id = v_stream.class_id
        and case p_event
          when 'awaiting_approval' then rc.comment_source = 'ai'
          else rc.comment_source = 'none' and btrim(coalesce(rc.comment, '')) <> ''
        end;
      if v_count > 0 then
        v_plural := case when v_count = 1 then '' else 's' end;
        v_verb := case when v_count = 1 then 'is' else 'are' end;
        v_url := '/exams/report-cards?exam=' || p_exam_id || '&class=' || v_stream.class_id;
        if p_event = 'awaiting_approval' then
          v_subject := 'Comments awaiting approval';
          v_body := format('%s comment%s in %s (%s) %s waiting to be approved.', v_count, v_plural, v_stream.class_name, v_exam_name, v_verb);
        else
          v_subject := 'Comments need re-approval';
          v_body := format('%s report card%s in %s (%s) need%s re-approval after a mark correction.', v_count, v_plural, v_stream.class_name, v_exam_name, case when v_count = 1 then 's' else '' end);
        end if;
        for v_admin in
          select su.id from school_users su
          where su.school_id = v_school
            and su.status = 'active'
            and su.id <> v_caller
            and not (su.id = any(v_notified))
            and school_user_has_permission(su.id, 'report_cards.approve_any')
        loop
          if _notify_report_card_once(v_admin.id, v_subject, v_body, v_url) then
            v_sent := v_sent + 1;
          end if;
        end loop;
      end if;
    end loop;
  end if;

  return v_sent;
end;
$$;

revoke all on function public.notify_report_card_event(text, uuid, uuid, uuid, uuid) from public, anon;
grant execute on function public.notify_report_card_event(text, uuid, uuid, uuid, uuid) to authenticated;

-- 4. Fail closed: privileges, then RUN the function as up to 5 real staff users inside subtransactions
--    that are always rolled back (nothing is kept). A run-time SQL error aborts the migration.
do $verify$
declare
  r record;
  ev text;
begin
  if has_function_privilege('anon', 'public.notify_report_card_event(text, uuid, uuid, uuid, uuid)', 'EXECUTE')
     or not has_function_privilege('authenticated', 'public.notify_report_card_event(text, uuid, uuid, uuid, uuid)', 'EXECUTE') then
    raise exception 'notify_report_card_event: unexpected EXECUTE grants';
  end if;
  if has_function_privilege('authenticated', 'public.school_user_has_permission(uuid, text)', 'EXECUTE')
     or has_function_privilege('anon', 'public.school_user_has_permission(uuid, text)', 'EXECUTE')
     or has_function_privilege('authenticated', 'public._notify_report_card_once(uuid, text, text, text)', 'EXECUTE')
     or has_function_privilege('anon', 'public._notify_report_card_once(uuid, text, text, text)', 'EXECUTE') then
    raise exception 'report card notification helpers must not be executable by API roles';
  end if;

  for r in
    select su.auth_user_id, e.id as exam_id, rc.class_id
    from school_users su
    join exams e on e.school_id = su.school_id and e.status = 'closed'
    join report_cards rc on rc.exam_id = e.id
    where su.status = 'active' and su.auth_user_id is not null
    limit 5
  loop
    foreach ev in array array['ready_for_comments', 'awaiting_approval', 'needs_reapproval', 'approved']
    loop
      begin
        perform set_config('request.jwt.claims', json_build_object('sub', r.auth_user_id, 'role', 'authenticated')::text, true);
        perform public.notify_report_card_event(ev, r.exam_id, r.class_id);
        raise exception using errcode = 'P0099', message = 'probe_rollback';
      exception
        when sqlstate 'P0099' then null;
      end;
    end loop;
  end loop;
  perform set_config('request.jwt.claims', '', true);
end
$verify$;
