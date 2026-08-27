-- Reconstructed from live schema introspection (Supabase project alzqlvfaftwegptfbfej).
-- Original SQL never committed to the repo. Current live definition resolves the caller's own
-- school_id and only logs/looks up a medical_records row scoped to that school — closing what
-- was presumably a cross-school access-logging gap.

CREATE OR REPLACE FUNCTION public.log_medical_record_access(p_student_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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
