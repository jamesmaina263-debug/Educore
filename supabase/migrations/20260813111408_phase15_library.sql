-- ============================================================================
-- Phase 15 (4/6): Library — Shelves, Staff Members, Reservations, Fines,
-- Lost/Damaged (Brief 4.11)
-- library_items/library_loans already handle books + student borrowing
-- correctly (REUSE). This adds: shelves, staff as borrowers alongside
-- students ("Members are existing Student/Staff records" -- no duplicate
-- person records, brief 4.11), reservations, and fines. issue_library_loan/
-- return_library_loan RPCs stay exactly as they are for students; a new,
-- additive RPC mirrors the same pattern for staff rather than changing the
-- existing one's signature.
-- ============================================================================

create table public.library_shelves (
  id uuid primary key default gen_random_uuid(),
  school_id uuid not null references public.schools(id),
  name text not null,
  location text,
  created_at timestamptz not null default now()
);

create unique index library_shelves_school_name_idx on public.library_shelves(school_id, name);

alter table public.library_shelves enable row level security;

create policy library_shelves_select on public.library_shelves for select
  using (auth_is_super_admin() or (school_id = auth_school_id() and auth_has_permission('library.read_any')));

create policy library_shelves_write on public.library_shelves for all
  using (auth_is_super_admin() or (school_id = auth_school_id() and auth_has_permission('library.write')))
  with check (auth_is_super_admin() or (school_id = auth_school_id() and auth_has_permission('library.write')));

alter table public.library_items add column shelf_id uuid references public.library_shelves(id);

-- Staff can borrow too. Adds staff_id alongside the existing student_id
-- rather than replacing it -- exactly one of the two must be set.
alter table public.library_loans add column staff_id uuid references public.school_users(id);

alter table public.library_loans
  add constraint library_loans_one_borrower_check
  check ((student_id is not null and staff_id is null) or (student_id is null and staff_id is not null));

-- Mirrors issue_library_loan() exactly, for a staff borrower.
create or replace function public.issue_library_loan_to_staff(p_item_id uuid, p_staff_id uuid, p_due_date date)
returns public.library_loans
language plpgsql
security definer
set search_path to 'public'
as $function$
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

  insert into library_loans (school_id, library_item_id, staff_id, issued_by, due_date)
  values (v_school_id, p_item_id, p_staff_id, v_issued_by, p_due_date)
  returning * into v_result;

  return v_result;
end;
$function$;

revoke all on function public.issue_library_loan_to_staff(uuid, uuid, date) from public, anon;
grant execute on function public.issue_library_loan_to_staff(uuid, uuid, date) to authenticated;

-- Adjust copy counts directly (new copies added, a lost/damaged copy
-- permanently removed, a damaged copy repaired and returned to service).
create or replace function public.adjust_library_item_copies(p_item_id uuid, p_total_delta int, p_available_delta int)
returns public.library_items
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_result public.library_items;
begin
  if not auth_has_permission('library.write') then
    raise exception 'insufficient permissions: library.write required';
  end if;

  update library_items
  set total_copies = total_copies + p_total_delta,
      available_copies = available_copies + p_available_delta,
      updated_at = now()
  where id = p_item_id and school_id = auth_school_id()
  returning * into v_result;

  if v_result.id is null then
    raise exception 'library item not found in this school';
  end if;
  if v_result.available_copies < 0 or v_result.total_copies < 0 or v_result.available_copies > v_result.total_copies then
    raise exception 'resulting copy counts would be invalid';
  end if;

  return v_result;
end;
$function$;

revoke all on function public.adjust_library_item_copies(uuid, int, int) from public, anon;
grant execute on function public.adjust_library_item_copies(uuid, int, int) to authenticated;

create table public.library_reservations (
  id uuid primary key default gen_random_uuid(),
  school_id uuid not null references public.schools(id),
  library_item_id uuid not null references public.library_items(id),
  student_id uuid references public.students(id),
  staff_id uuid references public.school_users(id),
  reserved_at timestamptz not null default now(),
  status text not null default 'pending' check (status in ('pending','ready','fulfilled','cancelled')),
  created_by uuid references public.school_users(id),
  constraint library_reservations_one_borrower_check
    check ((student_id is not null and staff_id is null) or (student_id is null and staff_id is not null))
);

create index library_reservations_item_idx on public.library_reservations(library_item_id);

alter table public.library_reservations enable row level security;

create policy library_reservations_select on public.library_reservations for select
  using (auth_is_super_admin() or (school_id = auth_school_id() and auth_has_permission('library.read_any')));

create policy library_reservations_write on public.library_reservations for all
  using (auth_is_super_admin() or (school_id = auth_school_id() and auth_has_permission('library.write')))
  with check (auth_is_super_admin() or (school_id = auth_school_id() and auth_has_permission('library.write')));

create table public.library_fines (
  id uuid primary key default gen_random_uuid(),
  school_id uuid not null references public.schools(id),
  loan_id uuid not null references public.library_loans(id),
  amount numeric(10,2) not null check (amount >= 0),
  reason text not null,
  status text not null default 'unpaid' check (status in ('unpaid','paid','waived')),
  created_by uuid references public.school_users(id),
  resolved_at timestamptz,
  created_at timestamptz not null default now()
);

create index library_fines_loan_idx on public.library_fines(loan_id);

alter table public.library_fines enable row level security;

create policy library_fines_select on public.library_fines for select
  using (auth_is_super_admin() or (school_id = auth_school_id() and auth_has_permission('library.read_any')));

create policy library_fines_write on public.library_fines for all
  using (auth_is_super_admin() or (school_id = auth_school_id() and auth_has_permission('library.write')))
  with check (auth_is_super_admin() or (school_id = auth_school_id() and auth_has_permission('library.write')));

create trigger trg_audit_library_fines
  after insert or update or delete on public.library_fines
  for each row execute function public.audit_row_change();
