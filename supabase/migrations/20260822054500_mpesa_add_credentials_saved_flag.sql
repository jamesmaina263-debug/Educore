-- Non-secret "have credentials ever been saved" signal, needed because mpesa_credentials has
-- zero select policies -- without this the settings UI can't distinguish "never saved
-- credentials" from "saved but not yet activated".
alter table public.mpesa_settings add column credentials_saved boolean not null default false;

create or replace function public.set_mpesa_credentials(
  p_shortcode text,
  p_shortcode_type text,
  p_environment text,
  p_consumer_key text,
  p_consumer_secret text,
  p_passkey text
)
returns void
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_school_id uuid;
  v_actor uuid;
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

  insert into public.mpesa_credentials (school_id, consumer_key, consumer_secret, passkey, updated_by)
  values (v_school_id, p_consumer_key, p_consumer_secret, p_passkey, v_actor)
  on conflict (school_id) do update
    set consumer_key = excluded.consumer_key,
        consumer_secret = excluded.consumer_secret,
        passkey = excluded.passkey,
        updated_by = excluded.updated_by;
end;
$function$;
