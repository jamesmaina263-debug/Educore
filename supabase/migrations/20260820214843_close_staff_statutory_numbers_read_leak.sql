-- Security fix: school_users.{kra_pin, nssf_number, shif_number, staff_number} were readable
-- by anyone in the school via the general school_users_select RLS policy.
--
-- That policy (school_users_select, set when the schema was first built) only checks tenant
-- membership -- no permission, no role check:
--   using (auth_is_super_admin() or school_id = auth_school_id())
-- Every school_user authenticates through real Supabase auth, including parent/student portal
-- accounts (phone + OTP). Since the app's server components use the anon-key client (RLS
-- genuinely applies, not a service-role bypass), any parent or student could query
-- school_users directly via the PostgREST API with their own session and read every staff
-- member's KRA PIN, NSSF number, SHIF number, and staff number -- real government statutory
-- identifiers, not cosmetic data.
--
-- The migration that added these columns (20260813150000_rectify_payslip_standard_fields)
-- already reasoned carefully about the WRITE side: it built update_staff_statutory_numbers(),
-- a narrow SECURITY DEFINER RPC gated on payroll.write, specifically to avoid widening the
-- general school_users UPDATE policy for these sensitive fields. It just never did the
-- equivalent for reads -- reads kept going through the general (unrestricted) SELECT policy.
-- This fixes that gap the same way: a narrow RPC, not a change to the general table policy
-- that ~70 files across the app depend on for ordinary staff-directory reads (name, email,
-- department, etc.) -- rewriting that policy blind, with no way to click through every one of
-- those call sites across every role, would risk breaking far more than it fixes.
--
-- Two layers, so this can't be bypassed by simply not using the RPC:
--   1. Column-level restriction: blocks reading these 4 columns via the standard PostgREST
--      request/embedded-join path entirely, for every role, regardless of RLS. This is what
--      actually closes the leak.
--   2. A SECURITY DEFINER function (which runs as its owner and isn't subject to the column
--      grant) provides the one legitimate way to read them: your own row, or any row if you
--      hold payroll.read_any -- mirroring update_staff_statutory_numbers()'s payroll.write gate
--      exactly.
--
-- IMPORTANT Postgres gotcha, learned the hard way verifying this against the live database:
-- `revoke select (col1, col2) on t from role` can ONLY undo a privilege that was explicitly
-- granted at the column level. It has no effect on access implied by a table-wide `grant
-- select on t to role` (which is what Supabase's default project setup actually did for
-- school_users) -- that access lives in a separate ACL entry (pg_class.relacl vs
-- pg_attribute.attacl) that a column-level revoke never touches. A first version of this
-- migration used exactly that column-level revoke, reported success, and was a complete
-- no-op -- confirmed via information_schema.column_privileges still showing SELECT for
-- authenticated/anon on all 4 columns after running it, then reproduced directly with `set
-- role authenticated; select kra_pin from school_users;` succeeding when it should have been
-- rejected. The only reliable way to carve columns out of an existing table-wide grant is to
-- revoke the table-wide grant entirely and re-grant SELECT explicitly on just the columns
-- that should remain readable -- which is what this migration actually does below. Re-verified
-- after this correction: the same direct query now fails with `permission denied for table
-- school_users`, and every other column (full_name, email, phone, department, gender, etc.)
-- still reads correctly, confirming nothing else on this widely-joined table broke.

revoke select on public.school_users from authenticated, anon;

grant select (
  id, auth_user_id, school_id, school_group_id, role_id, full_name, email, phone, status,
  created_at, updated_at, position, department, hire_date, contract_type, contract_end_date,
  must_change_password, temp_password_expires_at, password_changed_at, gender
) on public.school_users to authenticated, anon;

comment on column public.school_users.kra_pin is
  'Staff KRA PIN. Excluded from the table''s column-level SELECT grant to authenticated/anon (see the migration this column-level restriction was added in) -- read only via get_staff_statutory_numbers() (self or payroll.read_any), write only via update_staff_statutory_numbers() (payroll.write). Never select this column directly or embed it in a school_users(...) join -- both now fail with a permission-denied error rather than silently returning null, so a caller relying on it will find out immediately rather than shipping a working-but-empty read.';
comment on column public.school_users.nssf_number is 'See kra_pin comment on this table -- same access pattern.';
comment on column public.school_users.shif_number is 'See kra_pin comment on this table -- same access pattern.';
comment on column public.school_users.staff_number is 'See kra_pin comment on this table -- same access pattern.';

-- Set-returning: payroll/_data.ts loads statutory numbers for several staff at once (a
-- payroll run, a list of salary structures), so this takes an array rather than one id at a
-- time to avoid N round trips.
create or replace function public.get_staff_statutory_numbers(p_staff_ids uuid[])
returns table (
  staff_id uuid,
  staff_number text,
  kra_pin text,
  nssf_number text,
  shif_number text
)
language plpgsql
stable
security definer
set search_path to 'public'
as $$
declare
  v_caller_id uuid;
  v_can_read_any boolean := auth_has_permission('payroll.read_any');
begin
  select su.id into v_caller_id from school_users su where su.auth_user_id = auth.uid();

  return query
  select su.id, su.staff_number, su.kra_pin, su.nssf_number, su.shif_number
  from public.school_users su
  where su.id = any(p_staff_ids)
    and su.school_id = auth_school_id()
    and (v_can_read_any or su.id = v_caller_id);
end;
$$;

comment on function public.get_staff_statutory_numbers is
  'The only sanctioned read path for school_users.{kra_pin,nssf_number,shif_number,staff_number} -- see the column-level SELECT grant above (these 4 are deliberately excluded from it). Returns a row only for staff_ids the caller may see: their own, or any (within their school) if they hold payroll.read_any. Silently omits ids the caller can''t see rather than erroring, matching RLS-filter semantics elsewhere in this schema.';
