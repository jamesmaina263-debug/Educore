-- Mirrors issue_api_key() exactly: raw secret generated and hashed
-- entirely server-side (never round-trips through app code unhashed
-- except in this one return value, shown once), same prefix.secret
-- format the biometric-verify Edge Function already authenticates
-- against. bio_ prefix instead of tk_ just to keep the two key families
-- visually distinguishable in any list/log.
create or replace function public.issue_biometric_device_key(
  p_name text,
  p_device_type text,
  p_provider text default 'generic',
  p_location text default null,
  p_serial_number text default null
)
returns table (id uuid, raw_key text, key_prefix text)
language plpgsql
security definer
set search_path to 'public', 'extensions'
as $$
declare
  v_school_id uuid;
  v_secret text := encode(gen_random_bytes(24), 'hex');
  v_prefix text := 'bio_' || substr(encode(gen_random_bytes(4), 'hex'), 1, 8);
  v_id uuid;
begin
  v_school_id := public.auth_school_id();
  if v_school_id is null or not public.auth_has_permission('biometric.devices_manage') then
    raise exception 'insufficient privileges to register a biometric device';
  end if;

  insert into public.biometric_devices (school_id, name, device_type, provider, location, serial_number, api_key_prefix, api_key_hash, status)
  values (v_school_id, p_name, p_device_type, coalesce(p_provider, 'generic'), p_location, p_serial_number, v_prefix, encode(digest(v_secret, 'sha256'), 'hex'), 'active')
  returning biometric_devices.id into v_id;

  return query select v_id, (v_prefix || '.' || v_secret), v_prefix;
end;
$$;

revoke execute on function public.issue_biometric_device_key(text, text, text, text, text) from public, anon;
grant execute on function public.issue_biometric_device_key(text, text, text, text, text) to authenticated;
