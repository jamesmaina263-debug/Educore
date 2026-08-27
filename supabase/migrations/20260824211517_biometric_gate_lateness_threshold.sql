-- Lateness threshold for biometric gate attendance. Both nullable and
-- both default null -- unset means "no lateness distinction", which is
-- the exact behavior biometric-verify already has today (always marks
-- 'present'). Two separate thresholds (not one) because Kenyan schools
-- routinely run different start times for students vs staff.
alter table public.schools
  add column if not exists gate_late_after_student time,
  add column if not exists gate_late_after_staff time;

comment on column public.schools.gate_late_after_student is
  'Wall-clock time-of-day after which a biometric gate check_in for a student is marked late instead of present. Null = no lateness distinction.';
comment on column public.schools.gate_late_after_staff is
  'Wall-clock time-of-day after which a biometric gate check_in for staff is marked late instead of present. Null = no lateness distinction.';

-- Writing these goes through this RPC rather than a direct RLS-gated
-- update on `schools`, for the same reason issue_biometric_device_key is
-- an RPC and not a raw insert: the table's blanket UPDATE policy is gated
-- on settings.branding.write, which is the wrong permission for this --
-- someone with biometric.devices_manage (who already configures gate
-- devices) should be able to set the gate's lateness cutoff without also
-- holding branding-write access to the rest of the schools row.
create or replace function public.update_gate_late_thresholds(
  p_late_after_student time,
  p_late_after_staff time
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_school_id uuid;
begin
  if not auth_has_permission('biometric.devices_manage') then
    raise exception 'Not authorized to manage biometric gate settings.';
  end if;

  v_school_id := auth_school_id();
  if v_school_id is null then
    raise exception 'Could not resolve your school.';
  end if;

  update public.schools
  set gate_late_after_student = p_late_after_student,
      gate_late_after_staff = p_late_after_staff
  where id = v_school_id;
end;
$$;

revoke all on function public.update_gate_late_thresholds(time, time) from public;
grant execute on function public.update_gate_late_thresholds(time, time) to authenticated;
