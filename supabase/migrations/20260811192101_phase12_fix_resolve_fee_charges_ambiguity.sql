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

  select exists (select 1 from hostel_allocations where student_id = p_student_id and status = 'active') into v_is_boarder;
  select exists (select 1 from student_transport_assignments where student_id = p_student_id and status = 'active') into v_has_transport;

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
