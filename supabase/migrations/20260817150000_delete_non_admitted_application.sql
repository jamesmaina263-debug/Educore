-- Admissions list currently only lets an officer "Resume" a stuck draft, or
-- (buried inside the wizard) discard one -- there's no way to permanently clear
-- out an application once a student is genuinely not being admitted (rejected
-- or withdrawn), nor a quick delete for an abandoned draft directly from the
-- list. This adds one general-purpose permanent-delete path.
--
-- Deliberately scoped to only ever-non-admitted states (draft, rejected,
-- withdrawn) -- an application that's live in the pipeline or was actually
-- admitted/enrolled can never be deleted through this function, only through
-- deliberate status changes elsewhere in the app first.

create or replace function public.delete_application_permanently(p_application_id uuid)
returns void
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_application record;
begin
  select id, school_id, status into v_application from applications where id = p_application_id;
  if v_application.id is null then
    raise exception 'Application not found.';
  end if;

  if not (auth_is_super_admin() or (v_application.school_id = auth_school_id() and auth_has_permission('admissions.write'))) then
    raise exception 'Not authorized to delete this application.';
  end if;

  if v_application.status not in ('draft', 'rejected', 'withdrawn') then
    raise exception 'Only draft, rejected, or withdrawn applications can be permanently deleted -- this one is "%".', v_application.status;
  end if;

  -- Defensive: admission_enrollment_history has NO ACTION on delete. In practice a
  -- draft/rejected/withdrawn application should never have a history row (those are
  -- only written on actual enrollment completion), but this guards against that
  -- assumption ever silently breaking the delete instead of just no-op'ing.
  delete from admission_enrollment_history where application_id = p_application_id;

  -- documents rows cascade automatically; the caller is responsible for removing the
  -- underlying storage objects first (storage isn't reachable from SQL), same pattern
  -- as the existing per-document delete in the admissions wizard.
  delete from applications where id = p_application_id;
end;
$$;
revoke all on function public.delete_application_permanently(uuid) from public, anon;
grant execute on function public.delete_application_permanently(uuid) to authenticated;
