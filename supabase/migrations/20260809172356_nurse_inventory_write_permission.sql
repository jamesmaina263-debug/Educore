insert into public.role_permissions (role_id, school_id, permission_key, allowed)
select r.id, s.id, 'inventory.write', true
from public.roles r
cross join public.schools s
where r.name = 'nurse'
  and not exists (
    select 1 from public.role_permissions rp
    where rp.role_id = r.id and rp.school_id = s.id and rp.permission_key = 'inventory.write'
  );
