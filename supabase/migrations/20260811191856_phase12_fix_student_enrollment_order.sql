create or replace function public.create_student_from_application(p_application_id uuid)
returns uuid
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_school_id uuid := auth_school_id();
  v_app record;
  v_student_id uuid;
  v_admission_number text;
begin
  if not auth_has_permission('admissions.write') then
    raise exception 'insufficient permissions: admissions.write required';
  end if;

  select * into v_app from applications where id = p_application_id and school_id = v_school_id;
  if v_app is null then
    raise exception 'application not found in this school';
  end if;

  if v_app.resulting_student_id is not null then
    return v_app.resulting_student_id;
  end if;

  if v_app.first_name is null or v_app.last_name is null or v_app.date_of_birth is null or v_app.gender is null then
    raise exception 'Student biodata is incomplete -- first name, last name, date of birth and gender are all required.';
  end if;

  if not auth_has_permission('students.write') then
    raise exception 'insufficient permissions: students.write required to create the student record';
  end if;

  v_admission_number := generate_admission_number(v_school_id);

  insert into students (
    school_id, admission_number, first_name, last_name, other_names,
    date_of_birth, gender, current_class_id, status, admission_date
  )
  values (
    v_school_id, v_admission_number, v_app.first_name, v_app.last_name, v_app.other_names,
    v_app.date_of_birth, v_app.gender, v_app.intended_class_id, 'applied', current_date
  )
  returning id into v_student_id;

  update applications set resulting_student_id = v_student_id, updated_at = now()
  where id = p_application_id;

  return v_student_id;
end;
$$;

create or replace function public.advance_wizard_student_enrollment(p_student_id uuid)
returns text
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_school_id uuid := auth_school_id();
  v_status text;
  v_has_guardian boolean;
begin
  if not auth_has_permission('admissions.write') then
    raise exception 'insufficient permissions: admissions.write required';
  end if;

  select status into v_status from students where id = p_student_id and school_id = v_school_id;
  if v_status is null then
    raise exception 'student not found in this school';
  end if;

  select exists (
    select 1 from student_guardians where student_id = p_student_id and primary_contact = true
  ) into v_has_guardian;

  if not v_has_guardian then
    return v_status;
  end if;

  if v_status = 'applied' then
    update students set status = 'approved' where id = p_student_id;
    v_status := 'approved';
  end if;

  if v_status = 'approved' then
    update students set status = 'enrolled' where id = p_student_id;
    v_status := 'enrolled';
  end if;

  return v_status;
end;
$$;

revoke execute on function public.advance_wizard_student_enrollment(uuid) from public, anon;
grant execute on function public.advance_wizard_student_enrollment(uuid) to authenticated;
