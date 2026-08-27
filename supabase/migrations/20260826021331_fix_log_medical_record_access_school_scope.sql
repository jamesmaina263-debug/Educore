-- log_medical_record_access(p_student_id) had no school-scoping check: a caller could
-- pass a student_id belonging to a different school, and it would still look up that
-- student's medical_records row (a minor existence-oracle leak) and write an audit_log
-- entry mixing the caller's own school_id with another school's student_id/resource_id
-- -- polluting the audit trail. Low severity (no medical content is exposed, this
-- function only writes a log entry) and currently unused by any app code, but scoping it
-- properly costs nothing and matches the pattern applied elsewhere in this sweep.

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

  select id into v_medical_record_id
  from medical_records
  where student_id = p_student_id and school_id = v_caller_school_id;

  if v_medical_record_id is null then
    return;
  end if;

  insert into document_access_log (school_id, accessed_by, resource_type, resource_id, student_id)
  values (v_caller_school_id, v_caller_school_user_id, 'medical_record', v_medical_record_id, p_student_id);
end;
$function$;
