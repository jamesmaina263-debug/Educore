
create table invoices (
  id uuid primary key default gen_random_uuid(),
  school_id uuid not null references schools(id) on delete cascade,
  student_id uuid not null references students(id) on delete cascade,
  term_id uuid not null references terms(id) on delete restrict,
  fee_structure_id uuid references fee_structures(id) on delete set null,
  total_amount numeric(10,2) not null check (total_amount >= 0),
  -- Balances themselves are computed-on-read (blueprint Part D), but invoice-level status is
  -- maintained by a trigger (see finance_payments migration) and indexed, per the blueprint's own
  -- indexing guidance: "index (school_id, status) on invoices for balance queries." One row's status
  -- is cheap to keep current; a school-wide aggregate balance is not, hence the split.
  status text not null default 'unpaid' check (status in ('unpaid', 'partially_paid', 'paid')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (student_id, term_id)
);
comment on table invoices is 'total_amount is a snapshot of the fee structure at generation time — never recalculated if the fee structure changes later (blueprint Part D: a fee increase should never silently change what a family already agreed to pay this term).';

create table invoice_items (
  id uuid primary key default gen_random_uuid(),
  invoice_id uuid not null references invoices(id) on delete cascade,
  name text not null,
  amount numeric(10,2) not null,
  created_at timestamptz not null default now()
);

alter table invoices enable row level security;
alter table invoice_items enable row level security;

create index invoices_school_id_status_idx on invoices (school_id, status);
create index invoices_student_id_idx on invoices (student_id);
create index invoices_term_id_idx on invoices (term_id);
create index invoices_fee_structure_id_idx on invoices (fee_structure_id);
create index invoice_items_invoice_id_idx on invoice_items (invoice_id);

create policy invoices_select_staff on invoices for select
  using (school_id = auth_school_id() and auth_has_permission('finance.read'));
create policy invoices_select_guardian on invoices for select
  using (auth_user_id_is_guardian_of(invoices.student_id));
create policy invoices_select_self on invoices for select
  using (exists (select 1 from students st join school_users su on su.id = st.school_user_id where st.id = invoices.student_id and su.auth_user_id = auth.uid()));
-- No direct insert/update/delete policy for staff — invoices are only ever created by
-- generate_invoices() (SECURITY DEFINER) and their status only by the payment-allocation trigger.
-- This keeps "what a family owes" from being hand-edited outside the snapshot/payment mechanisms.

create policy invoice_items_select_staff on invoice_items for select
  using (exists (select 1 from invoices i where i.id = invoice_items.invoice_id and i.school_id = auth_school_id() and auth_has_permission('finance.read')));
create policy invoice_items_select_guardian on invoice_items for select
  using (exists (select 1 from invoices i where i.id = invoice_items.invoice_id and auth_user_id_is_guardian_of(i.student_id)));
create policy invoice_items_select_self on invoice_items for select
  using (exists (
    select 1 from invoices i
    join students st on st.id = i.student_id
    join school_users su on su.id = st.school_user_id
    where i.id = invoice_items.invoice_id and su.auth_user_id = auth.uid()
  ));

-- Generates one invoice per active student in scope, from the active fee structure matching
-- (school, term, class-or-schoolwide-default, boarding_type='day'). Boarder-specific structures
-- exist in the schema (fee_structures.boarding_type) but auto-generation only resolves 'day' for
-- now, since there's no students.boarding_type field yet to pick the right one per student — that's
-- Hostel-module territory (deferred). Skips any student who already has an invoice for this term
-- (idempotent, safe to re-run for newly admitted students mid-term).
create or replace function generate_invoices(p_term_id uuid, p_class_id uuid default null) returns integer
language plpgsql security definer set search_path = public as $$
declare
  v_school_id uuid := auth_school_id();
  v_count integer := 0;
  v_student record;
  v_structure_id uuid;
  v_total numeric;
  v_invoice_id uuid;
begin
  if not auth_has_permission('finance.write') then
    raise exception 'Not authorized to generate invoices.';
  end if;

  for v_student in
    select st.id as student_id, st.current_class_id, str.class_id
    from students st
    join streams str on str.id = st.current_class_id
    where st.school_id = v_school_id
      and st.status = 'active'
      and (p_class_id is null or str.class_id = p_class_id)
      and not exists (select 1 from invoices inv where inv.student_id = st.id and inv.term_id = p_term_id)
  loop
    select id into v_structure_id from fee_structures
      where school_id = v_school_id and term_id = p_term_id and class_id = v_student.class_id
        and boarding_type = 'day' and is_active
      limit 1;
    if v_structure_id is null then
      select id into v_structure_id from fee_structures
        where school_id = v_school_id and term_id = p_term_id and class_id is null
          and boarding_type = 'day' and is_active
        limit 1;
    end if;
    if v_structure_id is null then
      continue; -- no fee structure configured for this student's grade or school-wide default; skip, don't fail the whole batch
    end if;

    select coalesce(sum(amount), 0) into v_total from fee_items where fee_structure_id = v_structure_id;

    insert into invoices (school_id, student_id, term_id, fee_structure_id, total_amount)
    values (v_school_id, v_student.student_id, p_term_id, v_structure_id, v_total)
    returning id into v_invoice_id;

    insert into invoice_items (invoice_id, name, amount)
    select v_invoice_id, name, amount from fee_items where fee_structure_id = v_structure_id;

    v_count := v_count + 1;
  end loop;

  return v_count;
end;
$$;

revoke execute on function generate_invoices(uuid, uuid) from public, anon;
grant execute on function generate_invoices(uuid, uuid) to authenticated;
