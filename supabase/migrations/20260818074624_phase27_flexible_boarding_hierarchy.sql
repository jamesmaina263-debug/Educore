-- Phase 27 (audit item #5): House/Dormitory/Room hierarchy made genuinely optional.
--
-- Confirmed before this fix: dormitories.house_id was NOT NULL (a dormitory could
-- never exist without a house), hostel_rooms had no house_id column at all (a room
-- could only ever attach via a dormitory, never directly to a house or standalone),
-- and every create action + the Structure page's UI required the full parent chain
-- (createDormitory required house_id, createRoom required dormitory_id, both
-- non-optional in their TS types). A school that just wants flat "Dormitory A",
-- "Dormitory B" naming with no House concept, or simple room-level tracking with
-- no House/Dormitory at all, was forced to create a dummy House and/or Dormitory
-- first. This purely extends the schema -- nothing here is dropped or renamed, and
-- no existing row changes (5 houses / 4 dormitories / 2 rooms live, none affected).

-- A dormitory no longer requires a house (a school using flat "Dormitory" naming
-- with no House concept can now create one directly).
alter table public.dormitories alter column house_id drop not null;

-- A room can now attach directly to a house (skipping Dormitory entirely) instead
-- of only ever through a dormitory.
alter table public.hostel_rooms add column if not exists house_id uuid references public.boarding_houses(id);

-- A room's parent is at most one of {house_id, dormitory_id} -- never both, so
-- there's exactly one place to look up its lineage rather than two that could
-- disagree. (Room with neither set = standalone/flat, valid for a school using no
-- house/dormitory concept at all.)
alter table public.hostel_rooms add constraint hostel_rooms_one_parent_check
  check (house_id is null or dormitory_id is null);

create index idx_hostel_rooms_house_id on public.hostel_rooms(house_id) where house_id is not null;
