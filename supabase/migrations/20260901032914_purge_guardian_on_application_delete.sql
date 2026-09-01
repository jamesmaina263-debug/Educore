-- Lucy's report: when an online application is rejected, the guardian's identity
-- (school_users row -- name/phone/email, plus their auth.users login) is never
-- cleaned up. delete_application_permanently() (20260817190424) only ever removed
-- the `applications` row itself, so even after an officer explicitly "permanently
-- deletes" a rejected application, the parent's account keeps existing indefinitely
-- with nothing left pointing at it.
--
-- This does two things:
--   1. Widens delete_application_permanently() so that, once the application row
--      is gone, if the guardian on that application has no other applications and
--      no admitted/enrolled children (student_guardians), their account is purged
--      too via the existing delete_school_user_permanently() (20260823044534).
--      This only fires when the caller also holds guardians.delete -- a caller
--      with admissions.write alone can still delete the application itself, they
--      just won't also take out the guardian's login in the same click. Wrapped
--      in its own sub-transaction so a problem purging the guardian can never
--      undo the application deletion that already succeeded.
--   2. Grants guardians.delete to admissions.write roles by default (front_office/
--      admissions_officer, wherever that permission is granted) is deliberately
--      NOT done here -- guardian deletion is left as a school_owner/principal-only
--      action, same as the original migration intended. An officer who needs it
--      escalates to a manager, who does the delete themselves.

create or replace function public.delete_application_permanently(p_application_id uuid)
returns void
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_application record;
  v_remaining_applications integer;
  v_remaining_children integer;
begin
  select id, school_id, status, guardian_id into v_application from applications where id = p_application_id;
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

  -- Guardian cleanup: only when there's actually a guardian on the application, the
  -- caller can also manage guardians, and that guardian is left with nothing else
  -- pointing at them (no other application anywhere, no admitted/enrolled child).
  if v_application.guardian_id is not null and auth_has_permission('guardians.delete') then
    select count(*) into v_remaining_applications
    from applications where guardian_id = v_application.guardian_id;

    select count(*) into v_remaining_children
    from student_guardians where guardian_user_id = v_application.guardian_id;

    if v_remaining_applications = 0 and v_remaining_children = 0 then
      begin
        perform public.delete_school_user_permanently(
          v_application.guardian_id,
          'Auto-purged: no remaining applications or admitted children after permanently deleting application ' || p_application_id::text
        );
      exception when others then
        -- Never let a guardian-cleanup problem undo the application deletion above,
        -- which is the part the caller actually asked for and already succeeded.
        raise warning 'delete_application_permanently: guardian cleanup for % failed: %', v_application.guardian_id, sqlerrm;
      end;
    end if;
  end if;
end;
$$;

revoke all on function public.delete_application_permanently(uuid) from public, anon;
grant execute on function public.delete_application_permanently(uuid) to authenticated;
