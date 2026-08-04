create or replace function public.issue_library_loan(p_item_id uuid, p_student_id uuid, p_due_date date)
returns public.library_loans
language plpgsql security definer set search_path to 'public'
as $$
declare
  v_school_id uuid := auth_school_id();
  v_issued_by uuid;
  v_available int;
  v_result public.library_loans;
begin
  if not auth_has_permission('library.write') then
    raise exception 'insufficient permissions: library.write required';
  end if;

  select su.id into v_issued_by from school_users su where su.auth_user_id = auth.uid();

  select available_copies into v_available from library_items where id = p_item_id and school_id = v_school_id for update;
  if v_available is null then
    raise exception 'library item not found in this school';
  end if;
  if v_available < 1 then
    raise exception 'no copies available for this item';
  end if;

  update library_items set available_copies = available_copies - 1, updated_at = now() where id = p_item_id;

  insert into library_loans (school_id, library_item_id, student_id, issued_by, due_date)
  values (v_school_id, p_item_id, p_student_id, v_issued_by, p_due_date)
  returning * into v_result;

  return v_result;
end;
$$;

create or replace function public.return_library_loan(p_loan_id uuid)
returns public.library_loans
language plpgsql security definer set search_path to 'public'
as $$
declare
  v_result public.library_loans;
begin
  if not auth_has_permission('library.write') then
    raise exception 'insufficient permissions: library.write required';
  end if;

  update library_loans
  set status = 'returned', returned_at = current_date
  where id = p_loan_id and school_id = auth_school_id() and status = 'borrowed'
  returning * into v_result;

  if v_result.id is null then
    raise exception 'loan not found, not in this school, or already returned';
  end if;

  update library_items set available_copies = available_copies + 1, updated_at = now()
  where id = v_result.library_item_id;

  return v_result;
end;
$$;

create or replace function public.assign_transport(p_student_id uuid, p_route_id uuid, p_vehicle_id uuid, p_pickup_point text)
returns public.student_transport_assignments
language plpgsql security definer set search_path to 'public'
as $$
declare
  v_school_id uuid := auth_school_id();
  v_result public.student_transport_assignments;
begin
  if not auth_has_permission('transport.write') then
    raise exception 'insufficient permissions: transport.write required';
  end if;

  update student_transport_assignments
  set status = 'ended', end_date = current_date
  where student_id = p_student_id and status = 'active' and school_id = v_school_id;

  insert into student_transport_assignments (school_id, student_id, route_id, vehicle_id, pickup_point)
  values (v_school_id, p_student_id, p_route_id, p_vehicle_id, p_pickup_point)
  returning * into v_result;

  return v_result;
end;
$$;

create or replace function public.end_transport_assignment(p_id uuid)
returns public.student_transport_assignments
language plpgsql security definer set search_path to 'public'
as $$
declare
  v_result public.student_transport_assignments;
begin
  if not auth_has_permission('transport.write') then
    raise exception 'insufficient permissions: transport.write required';
  end if;

  update student_transport_assignments
  set status = 'ended', end_date = current_date
  where id = p_id and school_id = auth_school_id() and status = 'active'
  returning * into v_result;

  if v_result.id is null then
    raise exception 'assignment not found, not in this school, or already ended';
  end if;
  return v_result;
end;
$$;

create or replace function public.allocate_hostel_room(p_student_id uuid, p_room_id uuid)
returns public.hostel_allocations
language plpgsql security definer set search_path to 'public'
as $$
declare
  v_school_id uuid := auth_school_id();
  v_capacity int;
  v_occupied int;
  v_result public.hostel_allocations;
begin
  if not auth_has_permission('hostel.write') then
    raise exception 'insufficient permissions: hostel.write required';
  end if;

  select capacity into v_capacity from hostel_rooms where id = p_room_id and school_id = v_school_id for update;
  if v_capacity is null then
    raise exception 'hostel room not found in this school';
  end if;

  select count(*) into v_occupied from hostel_allocations where hostel_room_id = p_room_id and status = 'active';
  if v_occupied >= v_capacity then
    raise exception 'room is at full capacity (%/%)' , v_occupied, v_capacity;
  end if;

  update hostel_allocations
  set status = 'ended', end_date = current_date
  where student_id = p_student_id and status = 'active' and school_id = v_school_id;

  insert into hostel_allocations (school_id, student_id, hostel_room_id)
  values (v_school_id, p_student_id, p_room_id)
  returning * into v_result;

  return v_result;
end;
$$;

create or replace function public.end_hostel_allocation(p_id uuid)
returns public.hostel_allocations
language plpgsql security definer set search_path to 'public'
as $$
declare
  v_result public.hostel_allocations;
begin
  if not auth_has_permission('hostel.write') then
    raise exception 'insufficient permissions: hostel.write required';
  end if;

  update hostel_allocations
  set status = 'ended', end_date = current_date
  where id = p_id and school_id = auth_school_id() and status = 'active'
  returning * into v_result;

  if v_result.id is null then
    raise exception 'allocation not found, not in this school, or already ended';
  end if;
  return v_result;
end;
$$;

revoke all on function public.issue_library_loan, public.return_library_loan,
  public.assign_transport, public.end_transport_assignment,
  public.allocate_hostel_room, public.end_hostel_allocation from public, anon;
grant execute on function public.issue_library_loan to authenticated;
grant execute on function public.return_library_loan to authenticated;
grant execute on function public.assign_transport to authenticated;
grant execute on function public.end_transport_assignment to authenticated;
grant execute on function public.allocate_hostel_room to authenticated;
grant execute on function public.end_hostel_allocation to authenticated;
