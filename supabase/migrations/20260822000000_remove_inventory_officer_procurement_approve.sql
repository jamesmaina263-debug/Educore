-- Lucy's explicit instruction (2026-08-22): procurement requisitions should
-- be logged by the inventory officer but approved only by leadership
-- (school_owner/principal/deputy_principal) -- standard separation of
-- duties, so the person raising a requisition can't also be the one who
-- approves their own. inventory_officer previously held
-- inventory.procurement.approve as a default alongside those three roles;
-- removed here. inventory_officer keeps inventory.write (can still log/
-- submit requisitions), just not the approval step.
--
-- Checked before removing: no per-school override and no individual
-- inventory_officer had this granted directly via user_permission_overrides
-- -- this was the only row, so nothing else needs cleaning up.

delete from public.role_permissions
where role_id = (select id from public.roles where name = 'inventory_officer')
  and school_id is null
  and permission_key = 'inventory.procurement.approve';
