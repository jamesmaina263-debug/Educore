-- Reconstructed from live schema introspection (Supabase project alzqlvfaftwegptfbfej).
-- Original SQL never committed to the repo. The "documents storage bucket" half of this
-- migration's name could not be tied to a distinct live object beyond the
-- application-documents bucket already present from an earlier (in-repo) migration — likely a
-- storage policy adjustment that was later superseded and is no longer distinguishable from
-- current state. The RPC half is captured verbatim below.

CREATE OR REPLACE FUNCTION public.update_admission_identity(
  p_application_id uuid,
  p_first_name text,
  p_last_name text,
  p_other_names text,
  p_date_of_birth date,
  p_gender text
)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_app record;
begin
  if not auth_has_permission('admissions.write') then
    raise exception 'Not authorized to edit admission details.';
  end if;
  if p_first_name is null or btrim(p_first_name) = '' or p_last_name is null or btrim(p_last_name) = '' then
    raise exception 'First name and last name are required.';
  end if;
  if p_date_of_birth is null then
    raise exception 'Date of birth is required.';
  end if;
  if p_gender not in ('male', 'female') then
    raise exception 'Gender must be male or female.';
  end if;

  select * into v_app from public.applications
  where id = p_application_id and school_id = auth_school_id();
  if not found then
    raise exception 'Application not found.';
  end if;

  update public.applications
  set first_name = btrim(p_first_name),
      last_name = btrim(p_last_name),
      other_names = nullif(btrim(coalesce(p_other_names, '')), ''),
      date_of_birth = p_date_of_birth,
      gender = p_gender,
      updated_at = now()
  where id = p_application_id;

  if v_app.resulting_student_id is not null then
    if not auth_has_permission('students.write') then
      raise exception 'Not authorized to edit the linked student record.';
    end if;
    update public.students
    set first_name = btrim(p_first_name),
        last_name = btrim(p_last_name),
        other_names = nullif(btrim(coalesce(p_other_names, '')), ''),
        date_of_birth = p_date_of_birth,
        gender = p_gender
    where id = v_app.resulting_student_id and school_id = v_app.school_id;
  end if;
end;
$function$;

GRANT EXECUTE ON FUNCTION public.update_admission_identity(uuid, text, text, text, date, text) TO authenticated;
