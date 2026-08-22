-- Lucy's instruction (2026-08-22): the same separation of duties applied to
-- procurement (20260822000000) should apply to payroll -- prepared by
-- bursar/payroll_officer (payroll.write), approved only by leadership.
--
-- Preparer side was already correct: bursar and payroll_officer hold
-- payroll.write but never held payroll.approve (confirmed, no role default,
-- no per-school override, no individual grant). The gap was on the
-- approver side -- only school_owner had payroll.approve by default, unlike
-- the equivalent inventory.procurement.approve default which already
-- covers school_owner/principal/deputy_principal. Adds principal and
-- deputy_principal here to match.

insert into public.role_permissions (role_id, school_id, permission_key, allowed)
select r.id, null, 'payroll.approve', true
from public.roles r
where r.name in ('principal', 'deputy_principal')
  and not exists (
    select 1 from public.role_permissions rp
    where rp.role_id = r.id and rp.school_id is null and rp.permission_key = 'payroll.approve'
  );
