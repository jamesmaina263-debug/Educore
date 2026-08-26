-- Admissions fix backlog, Task 8: duplicate-student override has no secondary visibility.
-- createOrLinkStudent() (src/app/(app)/admissions/[id]/wizard/actions.ts) already records
-- duplicate_check_acknowledged on the application when an officer proceeds past a duplicate
-- warning (either creating a new student anyway, or linking to an existing one), but nothing
-- makes that override visible after the fact.
--
-- audit_log has no insert policy for regular clients (see its original migration comment:
-- "written only via SECURITY DEFINER trigger functions, never directly by client requests"),
-- so this can't be a plain client-side insert. This mirrors the existing pattern used by
-- delete_student_permanently() and complete_enrollment(): a small SECURITY DEFINER function,
-- called via RPC from the server action, that writes one audit_log row inside the same
-- transaction as the override itself.
create or replace function public.log_duplicate_override(
  p_application_id uuid,
  p_student_id uuid,
  p_candidate_ids uuid[]
)
returns void
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_school_id uuid;
  v_actor uuid;
begin
  if not auth_has_permission('admissions.write') then
    raise exception 'Not authorized to record an admissions override.';
  end if;

  select school_id into v_school_id
  from public.applications
  where id = p_application_id and school_id = auth_school_id();
  if not found then
    raise exception 'Application not found.';
  end if;

  v_actor := auth_school_user_id();

  insert into public.audit_log (school_id, actor_school_user_id, table_name, record_id, action, new_data)
  values (
    v_school_id,
    v_actor,
    'applications',
    p_application_id,
    'duplicate_override',
    jsonb_build_object('student_id', p_student_id, 'overridden_candidate_ids', to_jsonb(coalesce(p_candidate_ids, array[]::uuid[])))
  );
end;
$$;
