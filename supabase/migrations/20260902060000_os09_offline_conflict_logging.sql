-- ============================================================================
-- OS-09 (GTM Readiness Protocol): conflict-resolution rules for offline sync.
--
-- Scope, established by reading every entry in src/lib/offline/handlers.ts:
-- almost every queued offline mutation is a CREATE (attendance, health
-- check-ins, library loans, stock movements, discipline incidents, etc.) --
-- those can't "conflict" in the update sense, and OS-08 already gives them
-- duplicate-replay protection via client_mutation_id / event_id. The only
-- offline-queued mutations that UPDATE an existing shared record are the
-- three admissions wizard field-saves (updateAdmissionDetails,
-- updateApplicantIdentity, saveHealthProfileForApplication) -- see
-- docs/OFFLINE_ROLLOUT.md's "Deliberately not queued" notes, which already
-- exclude every other update/correction action from offline queueing by
-- policy (desk-based follow-up, not field work).
--
-- Policy chosen (founder decision, GTM tracker OS-09): field-level merge,
-- not last-write-wins. A queued edit only ever overwrites the specific
-- field(s) it touches, and only if nobody else changed that field since the
-- edit was drafted (compared against a `base` snapshot the client captured
-- when the form was loaded). If a field was changed by someone else in the
-- meantime, the newer value is kept, the queued edit's value for that field
-- is discarded, and the discard is logged here so it's never silent.
--
-- This RPC is the logging half only -- the merge decision itself happens in
-- the calling Server Action (src/app/(app)/admissions/[id]/wizard/actions.ts),
-- which already holds both the current row and the base snapshot and is a
-- much more natural place for a 3-6-field comparison than a new PL/pgSQL
-- function would be. Reuses the existing audit_log table (see
-- log_school_data_export in the SD-09 migration for the same pattern) rather
-- than a new table, since this is exactly what audit_log already exists for.
-- ============================================================================

create or replace function public.log_offline_field_conflict(
  p_table_name text,
  p_record_id uuid,
  p_field text,
  p_kept_value jsonb,
  p_discarded_value jsonb,
  p_base_value jsonb
)
returns void
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_school_user_id uuid;
  v_school_id uuid;
begin
  select su.id, su.school_id into v_school_user_id, v_school_id
  from school_users su
  where su.auth_user_id = auth.uid()
    and su.status = 'active'
  limit 1;

  if v_school_id is null then
    raise exception 'no active school context for caller';
  end if;

  insert into audit_log (school_id, actor_school_user_id, table_name, record_id, action, reason, old_data, new_data)
  values (
    v_school_id,
    v_school_user_id,
    p_table_name,
    p_record_id,
    'offline_conflict_field_discarded',
    format('Offline edit to "%s" was discarded: the record changed elsewhere since this edit was drafted.', p_field),
    jsonb_build_object('field', p_field, 'kept_value', p_kept_value, 'base_value_when_edit_drafted', p_base_value),
    jsonb_build_object('field', p_field, 'discarded_offline_value', p_discarded_value)
  );
end;
$$;

revoke all on function public.log_offline_field_conflict(text, uuid, text, jsonb, jsonb, jsonb) from public, anon;
grant execute on function public.log_offline_field_conflict(text, uuid, text, jsonb, jsonb, jsonb) to authenticated;
