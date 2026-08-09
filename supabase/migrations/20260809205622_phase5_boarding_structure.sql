-- Phase 5: Boarding — Houses -> Dormitories -> Rooms -> Beds.
-- Extends the existing hostel_rooms/hostel_allocations infrastructure
-- (Brief 4.1: "do not build parallel infrastructure") rather than replacing it.
-- Permission keys stay hostel.read_any/hostel.write (already granted to the
-- right roles) even though the UI is being relabeled "Boarding" — renaming
-- permission keys school-wide is a bigger, separate concern than this phase.

create table public.boarding_houses (
  id uuid primary key default gen_random_uuid(),
  school_id uuid not null references public.schools(id) on delete cascade,
  name text not null,
  description text,
  gender text not null check (gender in ('male', 'female', 'mixed')),
  capacity int,
  master_id uuid references public.school_users(id),
  assistant_id uuid references public.school_users(id),
  status text not null default 'active' check (status in ('active', 'inactive')),
  created_at timestamptz not null default now(),
  unique (school_id, name)
);

alter table public.boarding_houses enable row level security;

create policy boarding_houses_select on public.boarding_houses
  for select using (
    auth_is_super_admin()
    or (school_id = auth_school_id() and auth_has_permission('hostel.read_any'))
  );

create policy boarding_houses_write on public.boarding_houses
  for all using (
    auth_is_super_admin()
    or (school_id = auth_school_id() and auth_has_permission('hostel.write'))
  ) with check (
    auth_is_super_admin()
    or (school_id = auth_school_id() and auth_has_permission('hostel.write'))
  );

create table public.dormitories (
  id uuid primary key default gen_random_uuid(),
  school_id uuid not null references public.schools(id) on delete cascade,
  house_id uuid not null references public.boarding_houses(id) on delete cascade,
  name text not null,
  capacity int,
  gender text not null check (gender in ('male', 'female', 'mixed')),
  master_id uuid references public.school_users(id),
  assistant_id uuid references public.school_users(id),
  status text not null default 'active' check (status in ('active', 'inactive')),
  created_at timestamptz not null default now(),
  unique (house_id, name)
);

alter table public.dormitories enable row level security;

create policy dormitories_select on public.dormitories
  for select using (
    auth_is_super_admin()
    or (school_id = auth_school_id() and auth_has_permission('hostel.read_any'))
  );

create policy dormitories_write on public.dormitories
  for all using (
    auth_is_super_admin()
    or (school_id = auth_school_id() and auth_has_permission('hostel.write'))
  ) with check (
    auth_is_super_admin()
    or (school_id = auth_school_id() and auth_has_permission('hostel.write'))
  );

-- Rooms now sit under a dormitory. `block` is kept (not dropped) for
-- backward compatibility but is superseded by dormitory_id going forward.
alter table public.hostel_rooms
  add column if not exists dormitory_id uuid references public.dormitories(id),
  add column if not exists status text not null default 'active';

alter table public.hostel_rooms
  add constraint hostel_rooms_status_check check (status in ('active', 'maintenance', 'inactive'));

-- Beds: individual bed-level granularity under a room. `status` here is the
-- *administrative* state (available/reserved/unavailable) — "occupied" is
-- never stored here since it's fully derivable from an active allocation
-- (same "don't duplicate derivable state" principle as Finance balances).
create table public.beds (
  id uuid primary key default gen_random_uuid(),
  school_id uuid not null references public.schools(id) on delete cascade,
  room_id uuid not null references public.hostel_rooms(id) on delete cascade,
  bed_number text not null,
  status text not null default 'available' check (status in ('available', 'reserved', 'unavailable')),
  created_at timestamptz not null default now(),
  unique (room_id, bed_number)
);

create index idx_beds_room_id on public.beds(room_id);

alter table public.beds enable row level security;

create policy beds_select on public.beds
  for select using (
    auth_is_super_admin()
    or (school_id = auth_school_id() and auth_has_permission('hostel.read_any'))
  );

create policy beds_write on public.beds
  for all using (
    auth_is_super_admin()
    or (school_id = auth_school_id() and auth_has_permission('hostel.write'))
  ) with check (
    auth_is_super_admin()
    or (school_id = auth_school_id() and auth_has_permission('hostel.write'))
  );

-- Allocations now reference a specific bed. hostel_room_id is kept (not
-- dropped) for backward compatibility with the 2 existing rows and is
-- kept in sync via the bed's room going forward.
alter table public.hostel_allocations
  add column if not exists bed_id uuid references public.beds(id);

-- Prevent double-booking a bed: only one active allocation per bed at a time
-- (mirrors the existing hostel_alloc_one_active per-student index).
create unique index hostel_alloc_bed_one_active on public.hostel_allocations (bed_id) where (status = 'active' and bed_id is not null);

create table public.boarding_transfers (
  id uuid primary key default gen_random_uuid(),
  school_id uuid not null references public.schools(id) on delete cascade,
  student_id uuid not null references public.students(id) on delete cascade,
  from_bed_id uuid references public.beds(id),
  to_bed_id uuid not null references public.beds(id),
  transfer_date date not null default current_date,
  reason text,
  authorized_by uuid references public.school_users(id),
  created_at timestamptz not null default now()
);

create index idx_boarding_transfers_student on public.boarding_transfers(student_id);

alter table public.boarding_transfers enable row level security;

create policy boarding_transfers_select on public.boarding_transfers
  for select using (
    auth_is_super_admin()
    or (school_id = auth_school_id() and auth_has_permission('hostel.read_any'))
  );

create policy boarding_transfers_write on public.boarding_transfers
  for all using (
    auth_is_super_admin()
    or (school_id = auth_school_id() and auth_has_permission('hostel.write'))
  ) with check (
    auth_is_super_admin()
    or (school_id = auth_school_id() and auth_has_permission('hostel.write'))
  );

create table public.boarding_incidents (
  id uuid primary key default gen_random_uuid(),
  school_id uuid not null references public.schools(id) on delete cascade,
  student_id uuid not null references public.students(id) on delete cascade,
  incident_type text not null,
  incident_date timestamptz not null default now(),
  location text,
  description text not null,
  staff_id uuid references public.school_users(id),
  action_taken text,
  follow_up text,
  status text not null default 'open' check (status in ('open', 'closed')),
  created_at timestamptz not null default now()
);

create index idx_boarding_incidents_student on public.boarding_incidents(student_id);
create index idx_boarding_incidents_school_status on public.boarding_incidents(school_id, status);

alter table public.boarding_incidents enable row level security;

create policy boarding_incidents_select on public.boarding_incidents
  for select using (
    auth_is_super_admin()
    or (school_id = auth_school_id() and auth_has_permission('hostel.read_any'))
  );

create policy boarding_incidents_write on public.boarding_incidents
  for all using (
    auth_is_super_admin()
    or (school_id = auth_school_id() and auth_has_permission('hostel.write'))
  ) with check (
    auth_is_super_admin()
    or (school_id = auth_school_id() and auth_has_permission('hostel.write'))
  );

-- Roll call integrates with the existing Attendance table rather than a
-- separate system (Brief 4.1). A `session` column distinguishes class
-- attendance from AM/PM boarding roll call so a boarding student can have
-- both a class record and a roll-call record on the same day without
-- colliding on the old (stream_id, student_id, attendance_date) key.
alter table public.student_attendance
  add column if not exists session text not null default 'class';

alter table public.student_attendance
  add constraint student_attendance_session_check check (session in ('class', 'boarding_am', 'boarding_pm'));

alter table public.student_attendance drop constraint student_attendance_stream_id_student_id_attendance_date_key;
alter table public.student_attendance add constraint student_attendance_unique_session
  unique (stream_id, student_id, attendance_date, session);

alter table public.student_attendance drop constraint student_attendance_status_check;
alter table public.student_attendance add constraint student_attendance_status_check
  check (status in ('present', 'absent', 'late', 'sick_bay', 'excused'));

-- Backfill existing minimal data: one default House/Dormitory for the
-- existing room, beds 1..capacity, and the 2 existing active allocations
-- mapped onto beds 1 and 2.
do $$
declare
  v_school_id uuid;
  v_room record;
  v_house_id uuid;
  v_dorm_id uuid;
  v_bed_id uuid;
  v_alloc record;
  v_seq int := 1;
begin
  for v_room in select * from public.hostel_rooms loop
    v_school_id := v_room.school_id;

    insert into public.boarding_houses (school_id, name, gender, capacity)
    values (v_school_id, coalesce('House ' || v_room.block, 'Main House'), v_room.gender, v_room.capacity)
    on conflict (school_id, name) do update set gender = excluded.gender
    returning id into v_house_id;

    insert into public.dormitories (school_id, house_id, name, gender, capacity)
    values (v_school_id, v_house_id, v_room.room_number || ' Dormitory', v_room.gender, v_room.capacity)
    on conflict (house_id, name) do update set gender = excluded.gender
    returning id into v_dorm_id;

    update public.hostel_rooms set dormitory_id = v_dorm_id where id = v_room.id;

    for v_seq in 1..v_room.capacity loop
      insert into public.beds (school_id, room_id, bed_number)
      values (v_school_id, v_room.id, v_seq::text)
      on conflict (room_id, bed_number) do nothing;
    end loop;

    v_seq := 1;
    for v_alloc in select * from public.hostel_allocations where hostel_room_id = v_room.id and status = 'active' order by created_at loop
      select id into v_bed_id from public.beds where room_id = v_room.id and bed_number = v_seq::text;
      update public.hostel_allocations set bed_id = v_bed_id where id = v_alloc.id;
      update public.beds set status = 'available' where id = v_bed_id; -- occupied is derived, not stored
      v_seq := v_seq + 1;
    end loop;
  end loop;
end $$;
