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
