-- 1. Add Vault-secret-id columns alongside the existing plaintext ones.
alter table public.mpesa_credentials
  add column if not exists consumer_key_id uuid references vault.secrets(id),
  add column if not exists consumer_secret_id uuid references vault.secrets(id),
  add column if not exists passkey_id uuid references vault.secrets(id);

-- 2. Migrate any existing plaintext row(s) into Vault. This runs entirely
-- server-side in one statement -- the plaintext values are never returned
-- to a client or logged anywhere outside this transaction.
do $$
declare
  r record;
begin
  for r in
    select school_id, consumer_key, consumer_secret, passkey
    from public.mpesa_credentials
    where consumer_key_id is null
  loop
    update public.mpesa_credentials
    set
      consumer_key_id = vault.create_secret(r.consumer_key, 'mpesa_consumer_key:' || r.school_id::text),
      consumer_secret_id = vault.create_secret(r.consumer_secret, 'mpesa_consumer_secret:' || r.school_id::text),
      passkey_id = vault.create_secret(r.passkey, 'mpesa_passkey:' || r.school_id::text)
    where school_id = r.school_id;
  end loop;
end $$;

-- 3. Drop the plaintext columns now that everything has a Vault-backed copy.
alter table public.mpesa_credentials
  drop column consumer_key,
  drop column consumer_secret,
  drop column passkey;

-- 4. Rewrite set_mpesa_credentials() to write into Vault instead of plaintext
-- columns. Each re-save creates fresh Vault secrets and deletes the old
-- versions, matching the "rotate, don't edit in place" pattern the rest of
-- the app already uses for api_keys/biometric_devices.
create or replace function public.set_mpesa_credentials(
  p_shortcode text, p_shortcode_type text, p_environment text,
  p_consumer_key text, p_consumer_secret text, p_passkey text
)
returns void
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_school_id uuid;
  v_actor uuid;
  v_key_id uuid;
  v_secret_id uuid;
  v_passkey_id uuid;
  v_old_key_id uuid;
  v_old_secret_id uuid;
  v_old_passkey_id uuid;
begin
  if not public.auth_has_permission('mpesa.manage') then
    raise exception 'Not authorized to manage M-Pesa settings.';
  end if;
  if p_shortcode_type not in ('paybill', 'till') then
    raise exception 'Invalid shortcode type.';
  end if;
  if p_environment not in ('sandbox', 'production') then
    raise exception 'Invalid environment.';
  end if;
  if coalesce(p_shortcode, '') = '' or coalesce(p_consumer_key, '') = ''
     or coalesce(p_consumer_secret, '') = '' or coalesce(p_passkey, '') = '' then
    raise exception 'Shortcode and all three credential fields are required.';
  end if;

  v_school_id := public.auth_school_id();
  select su.id into v_actor from public.school_users su
    where su.auth_user_id = auth.uid() and su.status = 'active';

  insert into public.mpesa_settings (school_id, shortcode, shortcode_type, environment, credentials_saved, updated_by)
  values (v_school_id, p_shortcode, p_shortcode_type, p_environment, true, v_actor)
  on conflict (school_id) do update
    set shortcode = excluded.shortcode,
        shortcode_type = excluded.shortcode_type,
        environment = excluded.environment,
        credentials_saved = true,
        updated_by = excluded.updated_by;

  select consumer_key_id, consumer_secret_id, passkey_id
    into v_old_key_id, v_old_secret_id, v_old_passkey_id
    from public.mpesa_credentials where school_id = v_school_id;

  v_key_id := vault.create_secret(p_consumer_key, 'mpesa_consumer_key:' || v_school_id::text);
  v_secret_id := vault.create_secret(p_consumer_secret, 'mpesa_consumer_secret:' || v_school_id::text);
  v_passkey_id := vault.create_secret(p_passkey, 'mpesa_passkey:' || v_school_id::text);

  insert into public.mpesa_credentials (school_id, consumer_key_id, consumer_secret_id, passkey_id, updated_by, updated_at)
  values (v_school_id, v_key_id, v_secret_id, v_passkey_id, v_actor, now())
  on conflict (school_id) do update
    set consumer_key_id = excluded.consumer_key_id,
        consumer_secret_id = excluded.consumer_secret_id,
        passkey_id = excluded.passkey_id,
        updated_by = excluded.updated_by,
        updated_at = now();

  if v_old_key_id is not null then
    delete from vault.secrets where id in (v_old_key_id, v_old_secret_id, v_old_passkey_id);
  end if;
end;
$function$;

-- 5. Decrypt-only accessor, locked to service_role. This is the only way
-- the plaintext values can ever be read back, and only server-side code
-- holding the service role key (the mpesa-stk-push edge function) can call it.
create or replace function public.get_mpesa_credentials_decrypted(p_school_id uuid)
returns table(consumer_key text, consumer_secret text, passkey text)
language sql
security definer
set search_path to 'public'
as $function$
  select
    (select decrypted_secret from vault.decrypted_secrets where id = mc.consumer_key_id),
    (select decrypted_secret from vault.decrypted_secrets where id = mc.consumer_secret_id),
    (select decrypted_secret from vault.decrypted_secrets where id = mc.passkey_id)
  from public.mpesa_credentials mc
  where mc.school_id = p_school_id;
$function$;

revoke execute on function public.get_mpesa_credentials_decrypted(uuid) from public, anon, authenticated;
grant execute on function public.get_mpesa_credentials_decrypted(uuid) to service_role;
