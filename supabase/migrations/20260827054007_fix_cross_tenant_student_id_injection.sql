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

  if not exists (select 1 from students where id = p_student_id and school_id = v_school_id) then
    raise exception 'student not found in this school';
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

  if not exists (select 1 from students where id = p_student_id and school_id = v_school_id) then
    raise exception 'student not found in this school';
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

  if not exists (select 1 from students where id = p_student_id and school_id = v_school_id) then
    raise exception 'student not found in this school';
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

create or replace function public.assign_transport(
  p_student_id uuid,
  p_route_id uuid,
  p_vehicle_id uuid,
  p_pickup_point text,
  p_stop_id uuid default null
)
returns public.student_transport_assignments
language plpgsql security definer set search_path to 'public'
as $$
declare
  v_school_id uuid := auth_school_id();
  v_result public.student_transport_assignments;
  v_route_capacity int;
  v_route_allocated int;
  v_vehicle_capacity int;
  v_vehicle_allocated int;
  v_stop_capacity int;
  v_stop_allocated int;
begin
  if not auth_has_permission('transport.write') then
    raise exception 'insufficient permissions: transport.write required';
  end if;

  if not exists (select 1 from students where id = p_student_id and school_id = v_school_id) then
    raise exception 'student not found in this school';
  end if;

  if not exists (select 1 from transport_routes where id = p_route_id and school_id = v_school_id) then
    raise exception 'route not found in this school';
  end if;

  if p_vehicle_id is not null and not exists (select 1 from transport_vehicles where id = p_vehicle_id and school_id = v_school_id) then
    raise exception 'vehicle not found in this school';
  end if;

  if p_stop_id is not null and not exists (select 1 from transport_stops where id = p_stop_id and route_id = p_route_id and school_id = v_school_id) then
    raise exception 'stop not found on this route';
  end if;

  select capacity, allocated into v_route_capacity, v_route_allocated
  from v_transport_route_capacity where route_id = p_route_id;

  if v_route_capacity > 0 and v_route_allocated >= v_route_capacity then
    raise exception 'route is at full capacity (%/% seats taken)', v_route_allocated, v_route_capacity;
  end if;

  if p_vehicle_id is not null then
    select capacity into v_vehicle_capacity from transport_vehicles where id = p_vehicle_id for update;
    select count(*) into v_vehicle_allocated from student_transport_assignments where vehicle_id = p_vehicle_id and status = 'active';
    if v_vehicle_allocated >= v_vehicle_capacity then
      raise exception 'vehicle is at full capacity (%/% seats taken)', v_vehicle_allocated, v_vehicle_capacity;
    end if;
  end if;

  if p_stop_id is not null then
    select capacity, allocated into v_stop_capacity, v_stop_allocated from v_transport_stop_capacity where stop_id = p_stop_id;
    if v_stop_capacity is not null and v_stop_allocated >= v_stop_capacity then
      raise exception 'stop is at full capacity (%/% seats taken)', v_stop_allocated, v_stop_capacity;
    end if;
  end if;

  update student_transport_assignments
  set status = 'ended', end_date = current_date
  where student_id = p_student_id and status = 'active' and school_id = v_school_id;

  insert into student_transport_assignments (school_id, student_id, route_id, vehicle_id, pickup_point, stop_id)
  values (v_school_id, p_student_id, p_route_id, p_vehicle_id, p_pickup_point, p_stop_id)
  returning * into v_result;

  return v_result;
end;
$$;

create or replace function generate_invoices(p_term_id uuid, p_class_id uuid default null) returns integer
language plpgsql security definer set search_path = public as $$
declare
  v_school_id uuid := auth_school_id();
  v_count integer := 0;
  v_student record;
  v_structure_id uuid;
  v_transport_structure_id uuid;
  v_total numeric;
  v_invoice_id uuid;
  v_term_start date;
  v_is_boarder boolean;
  v_has_transport boolean;
  v_waiver record;
  v_waiver_amount numeric;
begin
  if not auth_has_permission('finance.write') then
    raise exception 'Not authorized to generate invoices.';
  end if;

  select start_date into v_term_start from terms where id = p_term_id;

  for v_student in
    select st.id as student_id, st.current_class_id, str.class_id
    from students st
    join streams str on str.id = st.current_class_id
    where st.school_id = v_school_id
      and st.status = 'active'
      and (p_class_id is null or str.class_id = p_class_id)
      and not exists (select 1 from invoices inv where inv.student_id = st.id and inv.term_id = p_term_id)
  loop
    select exists (select 1 from hostel_allocations where student_id = v_student.student_id and school_id = v_school_id and status = 'active') into v_is_boarder;
    select exists (select 1 from student_transport_assignments where student_id = v_student.student_id and school_id = v_school_id and status = 'active') into v_has_transport;

    select id into v_structure_id from fee_structures
      where school_id = v_school_id and term_id = p_term_id and class_id = v_student.class_id
        and fee_category = 'core' and boarding_type = (case when v_is_boarder then 'boarder' else 'day' end) and is_active
      limit 1;
    if v_structure_id is null then
      select id into v_structure_id from fee_structures
        where school_id = v_school_id and term_id = p_term_id and class_id is null
          and fee_category = 'core' and boarding_type = (case when v_is_boarder then 'boarder' else 'day' end) and is_active
        limit 1;
    end if;
    if v_structure_id is null then
      continue;
    end if;

    select coalesce(sum(amount), 0) into v_total from fee_items where fee_structure_id = v_structure_id;

    v_transport_structure_id := null;
    if v_has_transport then
      select id into v_transport_structure_id from fee_structures
        where school_id = v_school_id and term_id = p_term_id and class_id = v_student.class_id
          and fee_category = 'transport' and is_active
        limit 1;
      if v_transport_structure_id is null then
        select id into v_transport_structure_id from fee_structures
          where school_id = v_school_id and term_id = p_term_id and class_id is null
            and fee_category = 'transport' and is_active
          limit 1;
      end if;
      if v_transport_structure_id is not null then
        v_total := v_total + coalesce((select sum(amount) from fee_items where fee_structure_id = v_transport_structure_id), 0);
      end if;
    end if;

    insert into invoices (school_id, student_id, term_id, fee_structure_id, total_amount)
    values (v_school_id, v_student.student_id, p_term_id, v_structure_id, v_total)
    returning id into v_invoice_id;

    insert into invoice_items (invoice_id, name, amount)
    select v_invoice_id, name, amount from fee_items where fee_structure_id = v_structure_id;
    if v_transport_structure_id is not null then
      insert into invoice_items (invoice_id, name, amount)
      select v_invoice_id, name, amount from fee_items where fee_structure_id = v_transport_structure_id;
    end if;

    for v_waiver in
      select fw.id, fw.discount_kind, fw.discount_value, fw.name
      from fee_waivers fw
      where fw.student_id = v_student.student_id
        and fw.school_id = v_school_id
        and fw.status = 'active'
        and (fw.starts_term_id is null or exists (
          select 1 from terms t where t.id = fw.starts_term_id and t.start_date <= v_term_start))
        and (fw.ends_term_id is null or exists (
          select 1 from terms t where t.id = fw.ends_term_id and t.start_date >= v_term_start))
    loop
      v_waiver_amount := case
        when v_waiver.discount_kind = 'percentage' then round(v_total * v_waiver.discount_value / 100, 2)
        else least(v_waiver.discount_value, v_total)
      end;

      insert into discounts (school_id, student_id, invoice_id, amount, reason, status, waiver_id, approved_at)
      values (v_school_id, v_student.student_id, v_invoice_id, v_waiver_amount,
        'Auto-applied waiver: ' || v_waiver.name, 'approved', v_waiver.id, now());
    end loop;

    v_count := v_count + 1;
  end loop;

  return v_count;
end;
$$;

create or replace function public.create_or_get_invoice_for_student(p_student_id uuid, p_term_id uuid)
returns uuid
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_school_id uuid := auth_school_id();
  v_existing_id uuid;
  v_class_id uuid;
  v_structure_id uuid;
  v_transport_structure_id uuid;
  v_total numeric;
  v_invoice_id uuid;
  v_term_start date;
  v_is_boarder boolean;
  v_has_transport boolean;
  v_waiver record;
  v_waiver_amount numeric;
begin
  if not auth_has_permission('finance.write') then
    raise exception 'Not authorized to generate invoices.';
  end if;

  select id into v_existing_id from invoices where student_id = p_student_id and term_id = p_term_id;
  if v_existing_id is not null then
    return v_existing_id;
  end if;

  select str.class_id into v_class_id
    from students st join streams str on str.id = st.current_class_id
    where st.id = p_student_id and st.school_id = v_school_id;
  if v_class_id is null then
    raise exception 'Student has no class/stream assigned — cannot resolve a fee structure.';
  end if;

  select start_date into v_term_start from terms where id = p_term_id;
  select exists (select 1 from hostel_allocations where student_id = p_student_id and school_id = v_school_id and status = 'active') into v_is_boarder;
  select exists (select 1 from student_transport_assignments where student_id = p_student_id and school_id = v_school_id and status = 'active') into v_has_transport;

  select id into v_structure_id from fee_structures
    where school_id = v_school_id and term_id = p_term_id and class_id = v_class_id
      and fee_category = 'core' and boarding_type = (case when v_is_boarder then 'boarder' else 'day' end) and is_active
    limit 1;
  if v_structure_id is null then
    select id into v_structure_id from fee_structures
      where school_id = v_school_id and term_id = p_term_id and class_id is null
        and fee_category = 'core' and boarding_type = (case when v_is_boarder then 'boarder' else 'day' end) and is_active
      limit 1;
  end if;
  if v_structure_id is null then
    raise exception 'No fee structure configured for this student''s class/boarding-type/term.';
  end if;

  select coalesce(sum(amount), 0) into v_total from fee_items where fee_structure_id = v_structure_id;

  if v_has_transport then
    select id into v_transport_structure_id from fee_structures
      where school_id = v_school_id and term_id = p_term_id and class_id = v_class_id
        and fee_category = 'transport' and is_active
      limit 1;
    if v_transport_structure_id is null then
      select id into v_transport_structure_id from fee_structures
        where school_id = v_school_id and term_id = p_term_id and class_id is null
          and fee_category = 'transport' and is_active
        limit 1;
    end if;
    if v_transport_structure_id is not null then
      v_total := v_total + coalesce((select sum(amount) from fee_items where fee_structure_id = v_transport_structure_id), 0);
    end if;
  end if;

  insert into invoices (school_id, student_id, term_id, fee_structure_id, total_amount)
  values (v_school_id, p_student_id, p_term_id, v_structure_id, v_total)
  returning id into v_invoice_id;

  insert into invoice_items (invoice_id, name, amount)
  select v_invoice_id, name, amount from fee_items where fee_structure_id = v_structure_id;
  if v_transport_structure_id is not null then
    insert into invoice_items (invoice_id, name, amount)
    select v_invoice_id, name, amount from fee_items where fee_structure_id = v_transport_structure_id;
  end if;

  for v_waiver in
    select fw.id, fw.discount_kind, fw.discount_value, fw.name
    from fee_waivers fw
    where fw.student_id = p_student_id
      and fw.school_id = v_school_id
      and fw.status = 'active'
      and (fw.starts_term_id is null or exists (
        select 1 from terms t where t.id = fw.starts_term_id and t.start_date <= v_term_start))
      and (fw.ends_term_id is null or exists (
        select 1 from terms t where t.id = fw.ends_term_id and t.start_date >= v_term_start))
  loop
    v_waiver_amount := case
      when v_waiver.discount_kind = 'percentage' then round(v_total * v_waiver.discount_value / 100, 2)
      else least(v_waiver.discount_value, v_total)
    end;

    insert into discounts (school_id, student_id, invoice_id, amount, reason, status, waiver_id, approved_at)
    values (v_school_id, p_student_id, v_invoice_id, v_waiver_amount,
      'Auto-applied waiver: ' || v_waiver.name, 'approved', v_waiver.id, now());
  end loop;

  return v_invoice_id;
end;
$function$;

create or replace function resolve_fee_charges_for_student(p_student_id uuid, p_term_id uuid)
returns table (item_name text, amount numeric, fee_category text)
language plpgsql security definer set search_path = public as $$
declare
  v_school_id uuid := auth_school_id();
  v_class_id uuid;
  v_is_boarder boolean;
  v_has_transport boolean;
  v_core_structure_id uuid;
  v_transport_structure_id uuid;
begin
  if not auth_has_permission('finance.read') then
    raise exception 'Not authorized to view fee charges.';
  end if;
  if not exists (select 1 from students where id = p_student_id and school_id = v_school_id) then
    raise exception 'Student not found in your school.';
  end if;

  select str.class_id into v_class_id
    from students st join streams str on str.id = st.current_class_id
    where st.id = p_student_id;

  select exists (select 1 from hostel_allocations where student_id = p_student_id and school_id = v_school_id and status = 'active') into v_is_boarder;
  select exists (select 1 from student_transport_assignments where student_id = p_student_id and school_id = v_school_id and status = 'active') into v_has_transport;

  select fee_structures.id into v_core_structure_id from fee_structures
    where fee_structures.school_id = v_school_id and fee_structures.term_id = p_term_id and fee_structures.class_id = v_class_id
      and fee_structures.fee_category = 'core' and fee_structures.boarding_type = (case when v_is_boarder then 'boarder' else 'day' end) and fee_structures.is_active
    limit 1;
  if v_core_structure_id is null then
    select fee_structures.id into v_core_structure_id from fee_structures
      where fee_structures.school_id = v_school_id and fee_structures.term_id = p_term_id and fee_structures.class_id is null
        and fee_structures.fee_category = 'core' and fee_structures.boarding_type = (case when v_is_boarder then 'boarder' else 'day' end) and fee_structures.is_active
      limit 1;
  end if;

  if v_core_structure_id is not null then
    return query select fi.name, fi.amount, 'core'::text from fee_items fi where fi.fee_structure_id = v_core_structure_id;
  end if;

  if v_has_transport then
    select fee_structures.id into v_transport_structure_id from fee_structures
      where fee_structures.school_id = v_school_id and fee_structures.term_id = p_term_id and fee_structures.class_id = v_class_id
        and fee_structures.fee_category = 'transport' and fee_structures.is_active
      limit 1;
    if v_transport_structure_id is null then
      select fee_structures.id into v_transport_structure_id from fee_structures
        where fee_structures.school_id = v_school_id and fee_structures.term_id = p_term_id and fee_structures.class_id is null
          and fee_structures.fee_category = 'transport' and fee_structures.is_active
        limit 1;
    end if;
    if v_transport_structure_id is not null then
      return query select fi.name, fi.amount, 'transport'::text from fee_items fi where fi.fee_structure_id = v_transport_structure_id;
    end if;
  end if;

  return;
end;
$$;

drop policy if exists library_loans_select on public.library_loans;
create policy library_loans_select on public.library_loans
for select
using (
  auth_is_super_admin()
  or ((school_id = auth_school_id()) and auth_has_permission('library.read_any'))
  or (
    auth_user_id_is_guardian_of(student_id)
    and exists (select 1 from students st where st.id = library_loans.student_id and st.school_id = library_loans.school_id)
  )
  or (exists (
    select 1 from students st
    where st.id = library_loans.student_id
      and st.school_user_id = (
        select su.id from school_users su
        where su.auth_user_id = auth.uid() and su.status = 'active'
      )
  ))
  or (staff_id = auth_school_user_id())
);

drop policy if exists hostel_allocations_select on public.hostel_allocations;
create policy hostel_allocations_select on public.hostel_allocations
  for select using (
    auth_is_super_admin()
    or (school_id = auth_school_id() and auth_has_permission('hostel.read_any'))
    or (
      auth_user_id_is_guardian_of(student_id)
      and exists (select 1 from students st where st.id = hostel_allocations.student_id and st.school_id = hostel_allocations.school_id)
    )
    or (school_id = auth_school_id() and auth_has_permission('hostel.read_assigned') and exists (
      select 1 from public.beds b join public.hostel_rooms hr on hr.id = b.room_id join public.dormitories d on d.id = hr.dormitory_id
      where b.id = hostel_allocations.bed_id and auth_school_user_id() in (d.master_id, d.assistant_id)
    ))
  );

drop policy if exists student_transport_assignments_select on public.student_transport_assignments;
create policy student_transport_assignments_select on public.student_transport_assignments
  for select using (
    auth_is_super_admin()
    or (school_id = auth_school_id() and auth_has_permission('transport.read_any'))
    or (
      auth_user_id_is_guardian_of(student_id)
      and exists (select 1 from students st where st.id = student_transport_assignments.student_id and st.school_id = student_transport_assignments.school_id)
    )
    or exists (select 1 from students st where st.id = student_transport_assignments.student_id and st.school_user_id = (select su.id from school_users su where su.auth_user_id = (select auth.uid()) and su.status = 'active'))
  );
