-- Extends protect_schools_sensitive_fields (see that migration for the full
-- rationale) to three more columns found during the NEMIS/CBA sweep of the
-- per-route API audit, all sharing the same root cause: schools_update RLS
-- gates the whole table on settings.branding.write, so a direct API call
-- from a branding-only holder can touch columns meant for a different,
-- narrower permission.
--
-- - nemis_institution_code: set via updateNemisInstitutionCode, a plain
--   .update("schools") call with no dedicated RPC/permission of its own --
--   should require nemis.manage (matches every other NEMIS action:
--   generate_nemis_sync_batch, confirm_nemis_sync_batch,
--   reset_student_nemis_status all require it).
-- - knec_school_code: same pattern via updateKnecSchoolCode, should require
--   knec.manage (matches every KNEC action and the CBA assessment windows
--   table's own RLS).
-- - knec_cba_export_columns: already has a dedicated, validated setter
--   (update_knec_cba_export_columns, requires knec.manage, validates JSON
--   shape/known-keys/at-least-one-enabled) -- but nothing stopped a direct
--   schools update from overwriting it with arbitrary unvalidated JSON,
--   bypassing that validation entirely. Requiring knec.manage here doesn't
--   replace the dedicated RPC's validation for legitimate use, just closes
--   the direct-write bypass.
--
-- Verified live: benign field (name) update still works with no permission
-- held; a direct nemis_institution_code update without nemis.manage is now
-- rejected with a clear error.

create or replace function protect_schools_sensitive_fields()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $$
begin
  if auth_is_super_admin() or auth.role() = 'service_role' then
    return NEW;
  end if;

  if NEW.status is distinct from OLD.status then
    raise exception 'Only a super admin can change a school''s status. Use the platform admin reactivate/suspend controls.';
  end if;

  if NEW.expense_approval_threshold is distinct from OLD.expense_approval_threshold then
    raise exception 'expense_approval_threshold cannot be changed directly. Contact support.';
  end if;

  if NEW.fee_alert_threshold is distinct from OLD.fee_alert_threshold and not auth_has_permission('finance.write') then
    raise exception 'Changing the fee alert threshold requires finance.write. Use Finance settings instead.';
  end if;

  if NEW.nemis_institution_code is distinct from OLD.nemis_institution_code and not auth_has_permission('nemis.manage') then
    raise exception 'Changing the NEMIS institution code requires nemis.manage.';
  end if;

  if NEW.knec_school_code is distinct from OLD.knec_school_code and not auth_has_permission('knec.manage') then
    raise exception 'Changing the KNEC school code requires knec.manage.';
  end if;

  if NEW.knec_cba_export_columns is distinct from OLD.knec_cba_export_columns and not auth_has_permission('knec.manage') then
    raise exception 'Changing the KNEC CBA export column layout requires knec.manage. Use update_knec_cba_export_columns instead.';
  end if;

  return NEW;
end;
$$;
