-- Automatic timetable generation -- schema.
--
-- Two things were missing before an auto-generator could exist:
--
-- 1. class_subjects had no way to say "Math needs 5 periods/week for 3B" --
--    only who teaches it, not how much. School sets this manually per
--    class-subject (confirmed with product owner), so it's a plain editable
--    column, not derived from a curriculum table.
--
-- 2. There was no canonical school-wide period/day grid. Today each
--    timetable_slots row carries its own free-typed start_time/end_time, so
--    two streams' "period 3" can already legitimately be at different clock
--    times -- that's left alone for manual entry/bulk upload (no behavior
--    change to either). The generator needs one authoritative grid to place
--    slots into, so timetable_periods gives it that per school, with
--    is_teaching_period=false marking breaks/lunch (excluded from
--    scheduling, but kept in the table so the grid renders sensibly if a UI
--    wants to show a full day).

alter table class_subjects
  add column periods_per_week smallint check (periods_per_week is null or (periods_per_week > 0 and periods_per_week <= 20));
comment on column class_subjects.periods_per_week is 'How many periods/week this subject needs for this stream. Set manually by the school. Null = not configured yet; the auto-generator skips it and reports it as unconfigured rather than guessing.';

create table timetable_periods (
  id uuid primary key default gen_random_uuid(),
  school_id uuid not null references schools(id) on delete cascade,
  period_number smallint not null check (period_number > 0),
  start_time time not null,
  end_time time not null,
  is_teaching_period boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (school_id, period_number),
  check (end_time > start_time)
);
comment on table timetable_periods is 'Per-school canonical day/period grid used by automatic timetable generation. is_teaching_period=false rows (breaks/lunch) are excluded from scheduling. Seeded on first use by seed_default_timetable_periods() if a school has none configured yet -- this is deliberately not seeded for every school up front, so a school that never touches auto-generation never gets rows it did not ask for.';

create trigger trg_timetable_periods_updated_at before update on timetable_periods for each row execute function set_updated_at();

alter table timetable_periods enable row level security;

create index timetable_periods_school_id_idx on timetable_periods (school_id);

create policy timetable_periods_select on timetable_periods for select
  using (auth_is_super_admin() or (school_id = auth_school_id() and auth_has_permission('academics.read')));
create policy timetable_periods_write on timetable_periods for all
  using (auth_is_super_admin() or (school_id = auth_school_id() and auth_has_permission('academics.write')))
  with check (auth_is_super_admin() or (school_id = auth_school_id() and auth_has_permission('academics.write')));

-- Seeds a sensible default 8-teaching-period Kenyan school day (with a short
-- break and a lunch break) for the caller's school, but only if that school
-- has zero timetable_periods rows already -- never overwrites a school's own
-- customized grid. Returns the number of rows inserted (0 if already seeded).
create or replace function public.seed_default_timetable_periods() returns integer
language plpgsql security definer set search_path = public as $$
declare
  v_school_id uuid := auth_school_id();
  v_existing integer;
begin
  if not auth_has_permission('academics.write') then
    raise exception 'Not authorized to configure the timetable period grid.';
  end if;
  if v_school_id is null then
    raise exception 'Could not resolve your school.';
  end if;

  select count(*) into v_existing from timetable_periods where school_id = v_school_id;
  if v_existing > 0 then
    return 0;
  end if;

  insert into timetable_periods (school_id, period_number, start_time, end_time, is_teaching_period)
  values
    (v_school_id, 1, '08:00', '08:40', true),
    (v_school_id, 2, '08:40', '09:20', true),
    (v_school_id, 3, '09:20', '09:40', false), -- short break
    (v_school_id, 4, '09:40', '10:20', true),
    (v_school_id, 5, '10:20', '11:00', true),
    (v_school_id, 6, '11:00', '11:40', true),
    (v_school_id, 7, '11:40', '12:30', false), -- lunch
    (v_school_id, 8, '12:30', '13:10', true),
    (v_school_id, 9, '13:10', '13:50', true),
    (v_school_id, 10, '13:50', '14:30', true);

  return 8;
end;
$$;

revoke all on function public.seed_default_timetable_periods() from public, anon;
grant execute on function public.seed_default_timetable_periods() to authenticated;
