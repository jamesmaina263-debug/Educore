-- Adds staff gender (nullable, staff-only, mirrors the existing kra_pin/staff_number pattern
-- of extending school_users rather than a new table) and a per-leave-type gender restriction,
-- so Maternity/Paternity Leave can be scoped without hardcoding on the leave type's name string
-- (schools can rename/retire/add their own leave types via Settings > Leave Types, so matching
-- on "Maternity" text would silently break the moment a school edits that name).
--
-- Per explicit product decision: existing staff must set their gender before they can submit
-- ANY leave request, not just gendered ones -- enforced server-side below, not just hidden in
-- the UI, since leave_requests can in principle be written from anywhere hitting this schema.

alter table public.school_users
  add column if not exists gender text
  check (gender is null or gender in ('male', 'female'));

comment on column public.school_users.gender is
  'Staff only (null for parent/student/other roles, and null on staff until they set it). Required before a staff member can submit any leave request -- enforced by trg_enforce_leave_request_gender, not just hidden client-side.';

alter table public.leave_types
  add column if not exists restricted_gender text
  check (restricted_gender is null or restricted_gender in ('male', 'female'));

comment on column public.leave_types.restricted_gender is
  'If set, only staff whose gender matches may request this leave type (e.g. Maternity Leave -> female, Paternity Leave -> male). Null means available regardless of gender. Data-driven per leave type rather than matched on name, since schools can rename or add their own leave types.';

-- Update the seeding trigger (see 20260820012022_seed_default_leave_types.sql) to also seed
-- restricted_gender for the two defaults that need it. Schools remain free to change or clear
-- this via Settings > Leave Types, same as every other field on a leave type.
create or replace function public.seed_default_leave_types()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $$
begin
  insert into public.leave_types (school_id, name, days_per_year, restricted_gender)
  values
    (new.id, 'Annual Leave', 21, null),
    (new.id, 'Sick Leave', 14, null),
    (new.id, 'Maternity Leave', 90, 'female'),
    (new.id, 'Paternity Leave', 14, 'male'),
    (new.id, 'Compassionate Leave', 5, null),
    (new.id, 'Study Leave', 10, null)
  on conflict (school_id, name) do nothing;

  return new;
end;
$$;

-- Backfill: every school's Maternity/Paternity Leave rows seeded by the earlier migration
-- (both the trigger and its one-time backfill) predate restricted_gender and currently have it
-- null. Set it now by name, once -- this is a one-time data fix, not an ongoing name-matching
-- mechanism (the app itself never matches on name; see restricted_gender comment above). A
-- school that already renamed its Maternity/Paternity types before this migration ran is
-- matched by the original seeded name, so this still reaches them.
update public.leave_types set restricted_gender = 'female' where name = 'Maternity Leave' and restricted_gender is null;
update public.leave_types set restricted_gender = 'male' where name = 'Paternity Leave' and restricted_gender is null;

-- Server-side enforcement (defense in depth beyond the UI): a leave request can only be
-- inserted if the requesting staff member has a gender set, and if the chosen leave type is
-- gender-restricted, their gender must match it.
create or replace function public.enforce_leave_request_gender()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_staff_gender text;
  v_restricted_gender text;
begin
  select gender into v_staff_gender from public.school_users where id = new.staff_id;
  if v_staff_gender is null then
    raise exception 'Set your gender in your staff profile before requesting leave.';
  end if;

  select restricted_gender into v_restricted_gender from public.leave_types where id = new.leave_type_id;
  if v_restricted_gender is not null and v_restricted_gender <> v_staff_gender then
    raise exception 'This leave type is not available for your gender.';
  end if;

  return new;
end;
$$;

drop trigger if exists trg_enforce_leave_request_gender on public.leave_requests;
create trigger trg_enforce_leave_request_gender
  before insert on public.leave_requests
  for each row execute function public.enforce_leave_request_gender();
