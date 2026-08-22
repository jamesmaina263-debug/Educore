-- Students has no way to withdraw/transfer/graduate a student who leaves the school --
-- status defaults to enrolled/active on admission and nothing ever moves it. The status
-- check constraint (Phase 1) already allows withdrawn/transferred/graduated; this migration
-- adds the missing write path plus a reason field for the audit trail.
alter table public.students add column if not exists status_reason text;

create or replace function public.set_student_status(
  p_student_id uuid,
  p_status text,
  p_reason text default null
)
returns public.students
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_school_id uuid := auth_school_id();
  v_result public.students;
begin
  if not auth_has_permission('students.write') then
    raise exception 'insufficient permissions: students.write required';
  end if;

  if p_status not in ('active', 'withdrawn', 'transferred', 'graduated') then
    raise exception 'invalid status: % (must be active, withdrawn, transferred, or graduated)', p_status;
  end if;

  -- Lock the row so a concurrent status change can't race past the cascade below.
  perform 1 from students where id = p_student_id and school_id = v_school_id for update;
  if not found then
    raise exception 'student not found in this school';
  end if;

  update students
  set status = p_status,
      status_reason = p_reason,
      status_changed_at = now()
  where id = p_student_id and school_id = v_school_id
  returning * into v_result;

  -- Leaving active/enrolled: end any active transport/boarding assignments so they don't
  -- keep occupying a seat/bed for a student who's gone. Reactivating deliberately does NOT
  -- auto-restore them -- re-enrollment onto transport/boarding is a manual staff action,
  -- not something to silently resurrect from whatever it happened to be before.
  if p_status <> 'active' then
    update student_transport_assignments
    set status = 'ended', end_date = current_date
    where student_id = p_student_id and school_id = v_school_id and status = 'active';

    update hostel_allocations
    set status = 'ended', end_date = current_date
    where student_id = p_student_id and school_id = v_school_id and status = 'active';
  end if;

  return v_result;
end;
$function$;

revoke all on function public.set_student_status(uuid, text, text) from public, anon;
grant execute on function public.set_student_status(uuid, text, text) to authenticated;
