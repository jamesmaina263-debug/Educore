-- Phase 8, Item 2: fee structure engine stays the single calculation engine — extended, not
-- duplicated, to actually resolve boarding_type (previously hard-coded to 'day' — see the
-- original migration's own comment: "no students.boarding_type field yet to pick the right one
-- per student — that's Hostel-module territory (deferred)") now that Boarding (Phase 5) and
-- Transport (Phase 6) are built. A student's boarding_type is derived from whether they hold an
-- active bed allocation — never a stored column that could drift out of sync with Boarding's own
-- authoritative allocation records.

alter table fee_structures add column fee_category text not null default 'core'
  check (fee_category in ('core', 'transport'));
comment on column fee_structures.fee_category is '''core'' = the day/boarder tuition-and-related structure (boarding_type applies). ''transport'' = an add-on structure whose fee_items get merged into the same single per-term invoice when a student holds an active transport assignment — never a second invoice (invoices keeps its unique(student_id, term_id) constraint).';

create index fee_structures_fee_category_idx on fee_structures (fee_category);

-- Read-only preview of what a student would be charged for a term, using the exact same
-- resolution the real invoice-generation functions use below — reused so there is never a
-- second calculation engine (brief §4.7 item 2), including by the Admissions Step 9 charge
-- preview once the onboarding wizard is built.
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

  select id into v_core_structure_id from fee_structures
    where school_id = v_school_id and term_id = p_term_id and class_id = v_class_id
      and fee_category = 'core' and boarding_type = (case when v_is_boarder then 'boarder' else 'day' end) and is_active
    limit 1;
  if v_core_structure_id is null then
    select id into v_core_structure_id from fee_structures
      where school_id = v_school_id and term_id = p_term_id and class_id is null
        and fee_category = 'core' and boarding_type = (case when v_is_boarder then 'boarder' else 'day' end) and is_active
      limit 1;
  end if;

  if v_core_structure_id is not null then
    return query select fi.name, fi.amount, 'core'::text from fee_items fi where fi.fee_structure_id = v_core_structure_id;
  end if;

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
      return query select fi.name, fi.amount, 'transport'::text from fee_items fi where fi.fee_structure_id = v_transport_structure_id;
    end if;
  end if;

  return;
end;
$$;

revoke execute on function resolve_fee_charges_for_student(uuid, uuid) from public, anon;
grant execute on function resolve_fee_charges_for_student(uuid, uuid) to authenticated;

-- Batch generation (Fee Structures tab's existing "Generate invoices" action), now boarding- and
-- transport-aware via the same resolution as above, still one invoice per student per term.
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
    select exists (select 1 from hostel_allocations where student_id = v_student.student_id and status = 'active') into v_is_boarder;
    select exists (select 1 from student_transport_assignments where student_id = v_student.student_id and status = 'active') into v_has_transport;

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
      continue; -- no fee structure configured for this student's grade/boarding-type or school-wide default; skip, don't fail the whole batch
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

-- Single-student, idempotent equivalent of generate_invoices — the function the (future)
-- Admissions enrollment hook and the Finance reconciliation UI call for one student at a time.
-- If an invoice already exists for this student+term it is returned as-is, never duplicated
-- (invoices.unique(student_id, term_id) also enforces this at the DB level).
create or replace function create_or_get_invoice_for_student(p_student_id uuid, p_term_id uuid)
returns uuid
language plpgsql security definer set search_path = public as $$
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
  select exists (select 1 from hostel_allocations where student_id = p_student_id and status = 'active') into v_is_boarder;
  select exists (select 1 from student_transport_assignments where student_id = p_student_id and status = 'active') into v_has_transport;

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
$$;

revoke execute on function create_or_get_invoice_for_student(uuid, uuid) from public, anon;
grant execute on function create_or_get_invoice_for_student(uuid, uuid) to authenticated;
