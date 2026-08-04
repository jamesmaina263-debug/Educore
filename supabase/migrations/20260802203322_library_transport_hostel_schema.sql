-- ===== LIBRARY =====
create table public.library_items (
  id uuid primary key default gen_random_uuid(),
  school_id uuid not null references public.schools(id),
  title text not null,
  author text,
  isbn text,
  category text,
  total_copies int not null default 1 check (total_copies >= 0),
  available_copies int not null default 1 check (available_copies >= 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (available_copies <= total_copies)
);

create table public.library_loans (
  id uuid primary key default gen_random_uuid(),
  school_id uuid not null references public.schools(id),
  library_item_id uuid not null references public.library_items(id),
  student_id uuid not null references public.students(id),
  issued_by uuid references public.school_users(id),
  borrowed_at date not null default current_date,
  due_date date not null,
  returned_at date,
  status text not null default 'borrowed' check (status in ('borrowed','returned','lost')),
  notes text,
  created_at timestamptz not null default now()
);

alter table public.library_items enable row level security;
alter table public.library_loans enable row level security;

create policy library_items_select on public.library_items
  for select using (auth_is_super_admin() or (school_id = auth_school_id() and auth_has_permission('library.read_any')));
create policy library_items_insert on public.library_items
  for insert with check (auth_is_super_admin() or (school_id = auth_school_id() and auth_has_permission('library.write')));
create policy library_items_update on public.library_items
  for update using (auth_is_super_admin() or (school_id = auth_school_id() and auth_has_permission('library.write')));

create policy library_loans_select on public.library_loans
  for select using (
    auth_is_super_admin()
    or (school_id = auth_school_id() and auth_has_permission('library.read_any'))
    or auth_user_id_is_guardian_of(student_id)
    or exists (select 1 from students st where st.id = library_loans.student_id and st.school_user_id = (select su.id from school_users su where su.auth_user_id = (select auth.uid()) and su.status = 'active'))
  );
create policy library_loans_insert on public.library_loans
  for insert with check (auth_is_super_admin() or (school_id = auth_school_id() and auth_has_permission('library.write')));
create policy library_loans_update on public.library_loans
  for update using (auth_is_super_admin() or (school_id = auth_school_id() and auth_has_permission('library.write')));

-- ===== TRANSPORT =====
create table public.transport_routes (
  id uuid primary key default gen_random_uuid(),
  school_id uuid not null references public.schools(id),
  name text not null,
  description text,
  fee_amount numeric not null default 0 check (fee_amount >= 0),
  created_at timestamptz not null default now()
);

create table public.transport_vehicles (
  id uuid primary key default gen_random_uuid(),
  school_id uuid not null references public.schools(id),
  registration_number text not null,
  capacity int not null check (capacity > 0),
  route_id uuid references public.transport_routes(id),
  driver_name text,
  driver_phone text,
  created_at timestamptz not null default now()
);

create table public.student_transport_assignments (
  id uuid primary key default gen_random_uuid(),
  school_id uuid not null references public.schools(id),
  student_id uuid not null references public.students(id),
  route_id uuid not null references public.transport_routes(id),
  vehicle_id uuid references public.transport_vehicles(id),
  pickup_point text,
  start_date date not null default current_date,
  end_date date,
  status text not null default 'active' check (status in ('active','ended')),
  created_at timestamptz not null default now()
);
create unique index student_transport_one_active on public.student_transport_assignments (student_id) where status = 'active';

alter table public.transport_routes enable row level security;
alter table public.transport_vehicles enable row level security;
alter table public.student_transport_assignments enable row level security;

create policy transport_routes_select on public.transport_routes
  for select using (auth_is_super_admin() or (school_id = auth_school_id() and auth_has_permission('transport.read_any')));
create policy transport_routes_insert on public.transport_routes
  for insert with check (auth_is_super_admin() or (school_id = auth_school_id() and auth_has_permission('transport.write')));
create policy transport_routes_update on public.transport_routes
  for update using (auth_is_super_admin() or (school_id = auth_school_id() and auth_has_permission('transport.write')));

create policy transport_vehicles_select on public.transport_vehicles
  for select using (auth_is_super_admin() or (school_id = auth_school_id() and auth_has_permission('transport.read_any')));
create policy transport_vehicles_insert on public.transport_vehicles
  for insert with check (auth_is_super_admin() or (school_id = auth_school_id() and auth_has_permission('transport.write')));
create policy transport_vehicles_update on public.transport_vehicles
  for update using (auth_is_super_admin() or (school_id = auth_school_id() and auth_has_permission('transport.write')));

create policy student_transport_assignments_select on public.student_transport_assignments
  for select using (
    auth_is_super_admin()
    or (school_id = auth_school_id() and auth_has_permission('transport.read_any'))
    or auth_user_id_is_guardian_of(student_id)
    or exists (select 1 from students st where st.id = student_transport_assignments.student_id and st.school_user_id = (select su.id from school_users su where su.auth_user_id = (select auth.uid()) and su.status = 'active'))
  );
create policy student_transport_assignments_insert on public.student_transport_assignments
  for insert with check (auth_is_super_admin() or (school_id = auth_school_id() and auth_has_permission('transport.write')));
create policy student_transport_assignments_update on public.student_transport_assignments
  for update using (auth_is_super_admin() or (school_id = auth_school_id() and auth_has_permission('transport.write')));

-- ===== HOSTEL =====
create table public.hostel_rooms (
  id uuid primary key default gen_random_uuid(),
  school_id uuid not null references public.schools(id),
  room_number text not null,
  block text,
  capacity int not null check (capacity > 0),
  gender text not null default 'mixed' check (gender in ('male','female','mixed')),
  created_at timestamptz not null default now()
);

create table public.hostel_allocations (
  id uuid primary key default gen_random_uuid(),
  school_id uuid not null references public.schools(id),
  student_id uuid not null references public.students(id),
  hostel_room_id uuid not null references public.hostel_rooms(id),
  start_date date not null default current_date,
  end_date date,
  status text not null default 'active' check (status in ('active','ended')),
  created_at timestamptz not null default now()
);
create unique index hostel_alloc_one_active on public.hostel_allocations (student_id) where status = 'active';

alter table public.hostel_rooms enable row level security;
alter table public.hostel_allocations enable row level security;

create policy hostel_rooms_select on public.hostel_rooms
  for select using (auth_is_super_admin() or (school_id = auth_school_id() and auth_has_permission('hostel.read_any')));
create policy hostel_rooms_insert on public.hostel_rooms
  for insert with check (auth_is_super_admin() or (school_id = auth_school_id() and auth_has_permission('hostel.write')));
create policy hostel_rooms_update on public.hostel_rooms
  for update using (auth_is_super_admin() or (school_id = auth_school_id() and auth_has_permission('hostel.write')));

create policy hostel_allocations_select on public.hostel_allocations
  for select using (
    auth_is_super_admin()
    or (school_id = auth_school_id() and auth_has_permission('hostel.read_any'))
    or auth_user_id_is_guardian_of(student_id)
    or exists (select 1 from students st where st.id = hostel_allocations.student_id and st.school_user_id = (select su.id from school_users su where su.auth_user_id = (select auth.uid()) and su.status = 'active'))
  );
create policy hostel_allocations_insert on public.hostel_allocations
  for insert with check (auth_is_super_admin() or (school_id = auth_school_id() and auth_has_permission('hostel.write')));
create policy hostel_allocations_update on public.hostel_allocations
  for update using (auth_is_super_admin() or (school_id = auth_school_id() and auth_has_permission('hostel.write')));

revoke all on public.library_items, public.library_loans, public.transport_routes, public.transport_vehicles,
  public.student_transport_assignments, public.hostel_rooms, public.hostel_allocations from public, anon;
grant select, insert, update on public.library_items, public.library_loans, public.transport_routes, public.transport_vehicles,
  public.student_transport_assignments, public.hostel_rooms, public.hostel_allocations to authenticated;
