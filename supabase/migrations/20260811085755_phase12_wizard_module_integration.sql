-- ============================================================
-- Phase 12: Wire each onboarding-wizard step to its authoritative module
-- (Brief 4.16.9 steps 2-9). The wizard shell/autosave/draft machinery
-- already exists (Phase 11); this migration adds the pieces those steps
-- need that don't exist anywhere else yet, and otherwise reuses existing
-- module functions (resolve_fee_charges_for_student, create_or_get_invoice_
-- for_student, record_payment, assign_transport) as-is, per the brief's
-- repeated "do not build parallel infrastructure" instruction.
-- Final Review / Complete Enrollment / transaction-safety orchestration
-- (Brief 4.16.10-4.16.13) is explicitly Phase 13, not this one.
-- ============================================================

insert into public.roles (name, display_name, description, is_system_role)
select 'admissions_officer', 'Admissions Officer',
  'Manages applications and walk-in onboarding: reviews applications, and can initiate academic, boarding, transport, initial-health, and finance data entry within the Admissions wizard. Full clinical records remain Nurse-only.',
  true
where not exists (select 1 from public.roles where name = 'admissions_officer');

insert into public.role_permissions (role_id, school_id, permission_key, allowed)
select r.id, null, perm.key, true
from public.roles r
cross join (values
  ('admissions.read_any'),
  ('admissions.write'),
  ('students.read'),
  ('students.write'),
  ('students.documents.read'),
  ('students.documents.write'),
  ('students.medical.read'),
  ('students.medical.write'),
  ('academics.read'),
  ('hostel.read_any'),
  ('hostel.write'),
  ('transport.read_any'),
  ('transport.write'),
  ('finance.read'),
  ('finance.write')
) as perm(key)
where r.name = 'admissions_officer'
  and not exists (
    select 1 from public.role_permissions rp
    where rp.role_id = r.id and rp.school_id is null and rp.permission_key = perm.key
  );

create sequence if not exists public.admission_number_seq;

create or replace function public.generate_admission_number(p_school_id uuid)
returns text
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_year text := to_char(now(), 'YYYY');
  v_next int;
begin
  select coalesce(max(substring(admission_number from '\d+$')::int), 0) + 1
    into v_next
    from public.students
    where school_id = p_school_id and admission_number like 'EDU/' || v_year || '/%';
  return 'EDU/' || v_year || '/' || lpad(v_next::text, 5, '0');
end;
$$;

revoke execute on function public.generate_admission_number(uuid) from public, anon;
grant execute on function public.generate_admission_number(uuid) to authenticated;

create or replace view public.v_stream_capacity as
select
  st.id as stream_id,
  st.school_id,
  st.class_id,
  c.name as class_name,
  st.name as stream_name,
  st.capacity,
  count(s.id) filter (where s.status in ('enrolled', 'active'))::int as occupied,
  case when st.capacity is null then null
    else greatest(st.capacity - count(s.id) filter (where s.status in ('enrolled', 'active'))::int, 0)
  end as available
from public.streams st
join public.classes c on c.id = st.class_id
left join public.students s on s.current_class_id = st.id
group by st.id, st.school_id, st.class_id, c.name, st.name, st.capacity;

alter view public.v_stream_capacity set (security_invoker = true);

create or replace function public.find_possible_duplicate_students(
  p_first_name text,
  p_last_name text,
  p_date_of_birth date,
  p_guardian_phone text default null
)
returns table (
  id uuid,
  admission_number text,
  first_name text,
  last_name text,
  other_names text,
  date_of_birth date,
  status text,
  match_reason text
)
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_school_id uuid := auth_school_id();
begin
  if not auth_has_permission('admissions.write') then
    raise exception 'insufficient permissions: admissions.write required';
  end if;

  return query
  select distinct on (s.id)
    s.id, s.admission_number, s.first_name, s.last_name, s.other_names, s.date_of_birth, s.status,
    case
      when lower(s.first_name) = lower(p_first_name) and lower(s.last_name) = lower(p_last_name)
        and s.date_of_birth = p_date_of_birth then 'Same name and date of birth'
      when p_guardian_phone is not null and exists (
        select 1 from student_guardians sg
        join school_users su on su.id = sg.guardian_user_id
        where sg.student_id = s.id and su.phone = p_guardian_phone
      ) then 'Guardian phone number already on file'
      else 'Similar name'
    end as match_reason
  from students s
  where s.school_id = v_school_id
    and (
      (lower(s.first_name) = lower(p_first_name) and lower(s.last_name) = lower(p_last_name))
      or (p_guardian_phone is not null and exists (
        select 1 from student_guardians sg
        join school_users su on su.id = sg.guardian_user_id
        where sg.student_id = s.id and su.phone = p_guardian_phone
      ))
    )
  order by s.id, s.date_of_birth = p_date_of_birth desc;
end;
$$;

revoke execute on function public.find_possible_duplicate_students(text, text, date, text) from public, anon;
grant execute on function public.find_possible_duplicate_students(text, text, date, text) to authenticated;

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
    v_app.date_of_birth, v_app.gender, v_app.intended_class_id, 'enrolled', current_date
  )
  returning id into v_student_id;

  update applications set resulting_student_id = v_student_id, updated_at = now()
  where id = p_application_id;

  return v_student_id;
end;
$$;

revoke execute on function public.create_student_from_application(uuid) from public, anon;
grant execute on function public.create_student_from_application(uuid) to authenticated;

create index if not exists idx_applications_resulting_student on public.applications(resulting_student_id);

create or replace function public.allocate_bed(p_student_id uuid, p_bed_id uuid)
returns public.hostel_allocations
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_school_id uuid := auth_school_id();
  v_room_id uuid;
  v_bed_status text;
  v_result public.hostel_allocations;
begin
  if not auth_has_permission('hostel.write') then
    raise exception 'insufficient permissions: hostel.write required';
  end if;

  select room_id, status into v_room_id, v_bed_status from beds where id = p_bed_id and school_id = v_school_id for update;
  if v_room_id is null then
    raise exception 'bed not found in this school';
  end if;
  if v_bed_status = 'unavailable' then
    raise exception 'this bed is marked unavailable';
  end if;
  if exists (select 1 from hostel_allocations where bed_id = p_bed_id and status = 'active') then
    raise exception 'this bed is already occupied';
  end if;

  update hostel_allocations
  set status = 'ended', end_date = current_date
  where student_id = p_student_id and status = 'active' and school_id = v_school_id;

  insert into hostel_allocations (school_id, student_id, hostel_room_id, bed_id)
  values (v_school_id, p_student_id, v_room_id, p_bed_id)
  returning * into v_result;

  return v_result;
end;
$$;

revoke execute on function public.allocate_bed(uuid, uuid) from public, anon;
grant execute on function public.allocate_bed(uuid, uuid) to authenticated;

create or replace view public.v_bed_availability as
select
  b.id as bed_id,
  b.school_id,
  b.room_id,
  hr.room_number,
  hr.dormitory_id,
  d.name as dormitory_name,
  d.house_id,
  bh.name as house_name,
  bh.gender,
  b.bed_number,
  b.status as bed_status,
  exists (select 1 from hostel_allocations ha where ha.bed_id = b.id and ha.status = 'active') as occupied
from public.beds b
join public.hostel_rooms hr on hr.id = b.room_id
left join public.dormitories d on d.id = hr.dormitory_id
left join public.boarding_houses bh on bh.id = d.house_id;

alter view public.v_bed_availability set (security_invoker = true);
