-- pgcrypto lives in the `extensions` schema on this project (same as it
-- did on Trimora POS). Schema-qualifying the digest() calls rather than
-- widening search_path, which would be the wrong fix (search_path stays
-- minimal and predictable for these SECURITY DEFINER functions).

create or replace function generate_otp(p_phone text, p_purpose text default 'login')
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_code text;
begin
  v_code := lpad(floor(random() * 1000000)::text, 6, '0');

  update otp_codes
  set consumed_at = now()
  where phone = p_phone
    and purpose = p_purpose
    and consumed_at is null;

  insert into otp_codes (phone, purpose, code_hash, expires_at)
  values (p_phone, p_purpose, encode(extensions.digest(v_code, 'sha256'), 'hex'), now() + interval '10 minutes');

  return v_code;
end;
$$;

create or replace function verify_otp(p_phone text, p_code text, p_purpose text default 'login')
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_row otp_codes%rowtype;
begin
  select * into v_row
  from otp_codes
  where phone = p_phone
    and purpose = p_purpose
    and consumed_at is null
  order by created_at desc
  limit 1;

  if not found then
    return false;
  end if;

  if v_row.expires_at < now() then
    return false;
  end if;

  if v_row.attempt_count >= 5 then
    return false;
  end if;

  if v_row.code_hash <> encode(extensions.digest(p_code, 'sha256'), 'hex') then
    update otp_codes set attempt_count = attempt_count + 1 where id = v_row.id;
    return false;
  end if;

  update otp_codes set consumed_at = now() where id = v_row.id;
  return true;
end;
$$;

revoke execute on function generate_otp(text, text) from public, anon, authenticated;
revoke execute on function verify_otp(text, text, text) from public, anon, authenticated;
