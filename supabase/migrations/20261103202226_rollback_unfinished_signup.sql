-- R-new-17 follow-up: let signup rollback actually remove the half-created school. Additive only: one new function.
--
-- Why: rollbackSignup (src/app/signup/actions.ts) deletes the school through the API after removing the owner and the
-- seeded stock rows, and that final delete is refused (23503) for two reasons that exist independently of each other:
--   1. audit_log.school_id has a plain FK to schools, and trg_audit_school_users (Phase 17, 12 Aug 2026) writes an
--      audit_log row when the owner's school_users row is created;
--   2. biometric_profiles.school_id has a plain FK, and a trigger on school_users creates a profile row for the owner.
-- #770 (append-only audit_log) is NOT the cause and is unchanged; audit_log stays append-only for everyone else.
-- Result today: if a signup fails AFTER the owner row exists (start_trial_subscription error) the auth user is removed
-- but an orphan trial school stays. Never seen in production (0 schools without users), but it is reachable.
--
-- This function is the one sanctioned way to finish such a rollback. It is deliberately narrow:
--   * service_role only (the signup action's admin client); not callable by anon or signed-in users;
--   * only a brand-new trial school: status 'trial', created in the last 30 minutes, with NO school_users and NO students
--     left (the app removes the owner first), so it cannot remove a school anyone has started using;
--   * uses the existing educore.school_purge bypass (transaction-local, owner-level code only), so audit_log is never
--     rewritten except for rows of the school being removed, and nothing is logged during the removal.
-- Returns {deleted: true} or {deleted: false, reason: ...}; it never raises for a refused guard.
-- Rollback: drop function public.rollback_unfinished_signup(uuid);

create or replace function public.rollback_unfinished_signup(p_school_id uuid)
returns jsonb
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $function$
declare
  v_school public.schools%rowtype;
begin
  if p_school_id is null then
    return jsonb_build_object('deleted', false, 'reason', 'no_school_id');
  end if;

  select * into v_school from public.schools where id = p_school_id for update;
  if v_school.id is null then
    return jsonb_build_object('deleted', false, 'reason', 'not_found');
  end if;
  if v_school.status <> 'trial' or v_school.created_at < now() - interval '30 minutes' then
    return jsonb_build_object('deleted', false, 'reason', 'not_a_new_trial_school');
  end if;
  if exists (select 1 from public.school_users where school_id = p_school_id) then
    return jsonb_build_object('deleted', false, 'reason', 'has_users');
  end if;
  if exists (select 1 from public.students where school_id = p_school_id) then
    return jsonb_build_object('deleted', false, 'reason', 'has_students');
  end if;

  perform set_config('educore.school_purge', 'on', true);

  delete from public.school_subscriptions where school_id = p_school_id;
  delete from public.inventory_items where school_id = p_school_id;
  delete from public.inventory_categories where school_id = p_school_id;
  delete from public.biometric_profiles where school_id = p_school_id;
  delete from public.audit_log where school_id = p_school_id;
  delete from public.schools where id = p_school_id;

  perform set_config('educore.school_purge', 'off', true);
  return jsonb_build_object('deleted', true);
end;
$function$;

revoke all on function public.rollback_unfinished_signup(uuid) from public;
revoke execute on function public.rollback_unfinished_signup(uuid) from anon, authenticated;
grant execute on function public.rollback_unfinished_signup(uuid) to service_role;

comment on function public.rollback_unfinished_signup(uuid) is
  'service_role only. Finishes a failed signup by removing a brand-new trial school (no users, no students, under 30 minutes old), including the audit_log and biometric_profiles rows that block a plain delete. Refuses anything else.';
