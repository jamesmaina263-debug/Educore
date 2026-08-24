-- The enrollment UI needs to let a biometric.enroll holder pick which
-- device a credential is being registered against, but biometric_devices
-- only had one `for all` policy gated on biometric.devices_manage --
-- someone with only biometric.enroll couldn't read the device list at all.
-- Adding a narrower, additive SELECT policy rather than loosening the
-- existing one; write access (register/edit/deactivate a device, which is
-- where api_key_hash gets set) stays exclusively biometric.devices_manage.
-- The app layer is still responsible for never selecting api_key_hash/
-- api_key_prefix into an enrollment-only view -- RLS is row-level, not
-- column-level, same caveat noted on every other sensitive-column table
-- in this codebase (see close_staff_statutory_numbers_read_leak).
create policy biometric_devices_select_for_enrollers on public.biometric_devices
  for select
  using (
    auth_is_super_admin()
    or (school_id = auth_school_id() and (auth_has_permission('biometric.enroll') or auth_has_permission('biometric.view')))
  );
