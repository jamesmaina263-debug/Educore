-- Security audit follow-up (finance / medical / marks review, 2026-10-03), findings F4 + F5.
--
-- F4. log_medical_record_access(uuid) has been BROKEN IN PRODUCTION since 20260826021331.
--     That migration added `and school_id = v_caller_school_id` to a query on medical_records, but
--     medical_records has no school_id column (it is scoped through students.school_id, as its RLS
--     policies do). plpgsql only resolves columns at run time, so the migration applied cleanly and
--     every call since then fails with 42703 `column "school_id" does not exist`. The only caller
--     (students/[id]/medical-tab.tsx) ignores the RPC's returned error, so nothing surfaced: the
--     medical-record access audit trail was silently not being written (1 entry ever, vs 18
--     records). Reproduced against production by calling the function as a real staff user inside
--     a transaction that was then aborted.
--     Fix: scope through students.school_id (same as the table's RLS) AND only log when the caller
--     could actually read the record (super admin, students.medical.read, or guardian of the
--     student) -- previously any school user could have appended entries. A caller without access
--     still gets the function's existing silent no-op, so the UI is unchanged.
--
-- F5. notification_allowed(uuid, text, text) is SECURITY DEFINER and executable by every logged-in
--     user, so anyone can read any other user's notification-preference flag by UUID. Its only
--     callers are five SECURITY DEFINER SQL functions (notify_school_user, notify_users_with_
--     permission, queue_communication, send_fee_threshold_alert, send_term_newsletter_draft),
--     which run as the owner and do not need the caller's EXECUTE. No app code, policy, view or
--     trigger references it. Revoke EXECUTE from authenticated; service_role keeps it.
--
-- Idempotent; fails closed. The verification block also RUNS the repaired function as a real staff
-- user (inside a subtransaction that is rolled back, so no row is kept): a runtime error such as the
-- one above now aborts the migration instead of shipping.
--
-- Rollback:
--   grant execute on function public.notification_allowed(uuid, text, text) to authenticated;
--   (log_medical_record_access: re-create the previous definition from 20260826021331 -- which is
--    the broken one, so prefer fixing forward.)

create or replace function public.log_medical_record_access(p_student_id uuid)
 returns void
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare
  v_caller_school_user_id uuid;
  v_caller_school_id uuid;
  v_medical_record_id uuid;
begin
  select id, school_id into v_caller_school_user_id, v_caller_school_id
  from school_users where auth_user_id = auth.uid() and status = 'active';

  if v_caller_school_id is null then
    return;
  end if;

  -- medical_records has no school_id of its own: scope through the student's school, exactly like
  -- the table's RLS policies do.
  select m.id into v_medical_record_id
  from medical_records m
  join students s on s.id = m.student_id
  where m.student_id = p_student_id and s.school_id = v_caller_school_id;

  if v_medical_record_id is null then
    return;
  end if;

  -- Only log access the caller is actually entitled to (mirrors medical_records_select).
  if not (auth_is_super_admin()
          or auth_has_permission('students.medical.read')
          or auth_user_id_is_guardian_of(p_student_id)) then
    return;
  end if;

  insert into document_access_log (school_id, accessed_by, resource_type, resource_id, student_id)
  values (v_caller_school_id, v_caller_school_user_id, 'medical_record', v_medical_record_id, p_student_id);
end;
$function$;

-- Calls keep working exactly as before for logged-in users.
revoke execute on function public.log_medical_record_access(uuid) from public, anon;
grant execute on function public.log_medical_record_access(uuid) to authenticated, service_role;

-- F5
revoke execute on function public.notification_allowed(uuid, text, text) from authenticated;

do $verify$
declare
  r record;
begin
  if has_function_privilege('authenticated', 'public.notification_allowed(uuid, text, text)', 'EXECUTE') then
    raise exception 'F5: authenticated can still execute notification_allowed';
  end if;
  if not has_function_privilege('service_role', 'public.notification_allowed(uuid, text, text)', 'EXECUTE') then
    raise exception 'F5: service_role lost EXECUTE on notification_allowed';
  end if;
  if has_function_privilege('anon', 'public.log_medical_record_access(uuid)', 'EXECUTE')
     or not has_function_privilege('authenticated', 'public.log_medical_record_access(uuid)', 'EXECUTE') then
    raise exception 'F4: unexpected EXECUTE grants on log_medical_record_access';
  end if;

  -- Run-time probe: call the function as up to 5 real staff users that have a student with a medical
  -- record in their school. Any SQL error (undefined column, etc.) propagates and aborts the
  -- migration. Each call runs in a subtransaction that is always rolled back (P0099), so nothing is
  -- written. A silent no-op is fine (no data / no permission); an exception is not.
  for r in
    select su.auth_user_id, s.id as student_id
    from school_users su
    join students s on s.school_id = su.school_id
    join medical_records m on m.student_id = s.id
    where su.status = 'active' and su.auth_user_id is not null
    limit 5
  loop
    begin
      perform set_config('request.jwt.claims',
        json_build_object('sub', r.auth_user_id, 'role', 'authenticated')::text, true);
      perform public.log_medical_record_access(r.student_id);
      raise exception using errcode = 'P0099', message = 'probe_rollback';
    exception
      when sqlstate 'P0099' then null;
    end;
  end loop;
  perform set_config('request.jwt.claims', '', true);
end
$verify$;
