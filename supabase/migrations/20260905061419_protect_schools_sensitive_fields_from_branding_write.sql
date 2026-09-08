-- Per-route API audit finding: schools_update RLS (UPDATE gated on
-- settings.branding.write, table-wide -- RLS is row-level, not
-- column-level) covers every column on schools, including status,
-- expense_approval_threshold, and fee_alert_threshold. This app's own
-- server actions only ever touch the intended branding fields
-- (updateBranding in settings/actions.ts), but RLS -- not app code -- is
-- the real enforcement boundary: anyone holding settings.branding.write
-- can call the Supabase REST API directly with their own session token and
-- include any column in the update payload, entirely bypassing what the
-- Next.js app's UI/actions expose.
--
-- Concretely exploitable, not just theoretical:
--   - status: reactivate_school()/suspend_subscription() are SECURITY
--     DEFINER RPCs deliberately restricted to super admin / service_role,
--     specifically so a school can't lift its own payment suspension. A
--     direct schools update bypasses that restriction entirely for anyone
--     with branding.write.
--   - expense_approval_threshold: raise_expense() auto-approves any
--     expense at or under this value with NO expenses.approve permission
--     check at all (see that function's own logic). No app code sets this
--     column today, but nothing stopped a branding.write holder from
--     setting it to an arbitrary large number via a direct API call and
--     then self-approving large expenses -- the same self-approval-bypass
--     class already found and fixed once for discounts.
--   - fee_alert_threshold: has its own correctly-scoped setter
--     (set_fee_alert_threshold, requires finance.write) which itself does
--     a direct `update schools` -- so this trigger must allow finance.write
--     through for this column specifically, not just super_admin, or it
--     would break that legitimate path.
--
-- Fix: a BEFORE UPDATE trigger, same pattern as
-- validate_academic_year_mutation, blocking changes to these three columns
-- unless the caller is super_admin/service_role (status,
-- expense_approval_threshold) or holds finance.write (fee_alert_threshold
-- only, matching set_fee_alert_threshold's own gate). No legitimate
-- app flow is affected: reactivate_school/suspend_subscription run as
-- super_admin-gated SECURITY DEFINER already; set_fee_alert_threshold's
-- caller already has finance.write by the time it reaches this update.
--
-- Verified live: name (benign field) still updates fine as a non-super-admin
-- caller; both `status` and `expense_approval_threshold` direct updates are
-- rejected with a clear error as the same caller.

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

  return NEW;
end;
$$;

create trigger trg_schools_protect_sensitive_fields
before update on public.schools
for each row execute function protect_schools_sensitive_fields();
