-- gen_random_bytes()/digest() live in extensions, not public -- issue_api_key's search_path
-- didn't include it. Fix only, no logic change.
create or replace function public.issue_api_key(
  p_name text,
  p_scopes text[],
  p_school_id uuid default null,
  p_school_group_id uuid default null,
  p_expires_at timestamptz default null
)
returns table (id uuid, raw_key text, key_prefix text)
language plpgsql
security definer
set search_path to 'public', 'extensions'
as $function$
declare
  v_caller_su uuid;
  v_secret text := encode(gen_random_bytes(24), 'hex');
  v_prefix text := 'tk_' || substr(encode(gen_random_bytes(4), 'hex'), 1, 8);
  v_id uuid;
begin
  select su.id into v_caller_su
  from school_users su
  where su.auth_user_id = auth.uid() and su.status = 'active';

  if v_caller_su is null or not public.auth_has_permission('api.manage') then
    raise exception 'insufficient privileges to issue an API key';
  end if;

  if (p_school_id is null) = (p_school_group_id is null) then
    raise exception 'exactly one of p_school_id or p_school_group_id must be set';
  end if;

  if p_school_id is not null and p_school_id is distinct from public.auth_school_id() then
    raise exception 'cannot issue a key for a school outside your own scope';
  end if;
  if p_school_group_id is not null and p_school_group_id is distinct from public.auth_group_id() then
    raise exception 'cannot issue a key for a group outside your own scope';
  end if;

  insert into api_keys (school_id, school_group_id, name, key_prefix, key_hash, scopes, created_by, expires_at)
  values (p_school_id, p_school_group_id, p_name, v_prefix, encode(digest(v_secret, 'sha256'), 'hex'), p_scopes, v_caller_su, p_expires_at)
  returning api_keys.id into v_id;

  return query select v_id, (v_prefix || '.' || v_secret), v_prefix;
end;
$function$;
