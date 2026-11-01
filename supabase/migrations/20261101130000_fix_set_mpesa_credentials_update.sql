-- Fix: "Update credentials" failed for any school that already had M-Pesa credentials saved
-- ("duplicate key value violates unique constraint secrets_name_idx").
--
-- Cause: set_mpesa_credentials() called vault.create_secret() with the per-school secret names
-- ('mpesa_consumer_key:<school>', etc.) BEFORE deleting the previous secrets, so the second save for
-- a school always collided with its own earlier secrets. Only a school's very first save worked.
--
-- Fix: when a credentials row already exists, update the three vault secrets IN PLACE with
-- vault.update_secret() (same ids, same names, no new rows). On a first save, clear any orphaned
-- secrets that carry this school's names (left behind if a credentials row was removed by hand),
-- then create them. Everything else -- signature, permission check, validation, the settings upsert,
-- security definer, search_path, grants -- is unchanged. CREATE OR REPLACE keeps the existing grants.
--
-- No data is read back or returned; secret values are never logged. No schema change.
-- Rollback: re-apply the previous definition from 20260828064348_encrypt_mpesa_credentials_via_vault.sql.

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
    into v_key_id, v_secret_id, v_passkey_id
    from public.mpesa_credentials where school_id = v_school_id;

  if found then
    -- Credentials already saved: replace the secret values in place (same ids and names).
    perform vault.update_secret(v_key_id, p_consumer_key);
    perform vault.update_secret(v_secret_id, p_consumer_secret);
    perform vault.update_secret(v_passkey_id, p_passkey);
    update public.mpesa_credentials
      set updated_by = v_actor, updated_at = now()
      where school_id = v_school_id;
  else
    -- First save. No credentials row references these names, so any secret still carrying them is
    -- an orphan and would collide on create; clear it first.
    delete from vault.secrets
      where name in ('mpesa_consumer_key:' || v_school_id::text,
                     'mpesa_consumer_secret:' || v_school_id::text,
                     'mpesa_passkey:' || v_school_id::text);

    v_key_id := vault.create_secret(p_consumer_key, 'mpesa_consumer_key:' || v_school_id::text);
    v_secret_id := vault.create_secret(p_consumer_secret, 'mpesa_consumer_secret:' || v_school_id::text);
    v_passkey_id := vault.create_secret(p_passkey, 'mpesa_passkey:' || v_school_id::text);

    insert into public.mpesa_credentials (school_id, consumer_key_id, consumer_secret_id, passkey_id, updated_by, updated_at)
    values (v_school_id, v_key_id, v_secret_id, v_passkey_id, v_actor, now());
  end if;
end;
$function$;
