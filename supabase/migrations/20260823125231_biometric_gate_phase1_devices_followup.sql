-- Small additive follow-up: track device key usage the same way api_keys does,
-- and index the enrollment lookup path the webhook will hit on every scan.
alter table public.biometric_devices
  add column last_used_at timestamptz;

create index idx_biometric_enrollments_device_template
  on public.biometric_enrollments (device_id, external_template_id)
  where status = 'active';

create index idx_biometric_enrollments_person
  on public.biometric_enrollments (school_id, person_type, person_id);
