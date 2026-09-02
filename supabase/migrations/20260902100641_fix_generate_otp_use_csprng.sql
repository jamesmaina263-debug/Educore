-- Auth audit finding: generate_otp() has always used Postgres's random()
-- to produce the 6-digit login OTP sent by SMS/email. random() is
-- explicitly documented as NOT cryptographically secure (it's a standard
-- PRNG, not a CSPRNG) -- an unsuitable entropy source for a value that
-- authenticates a login, even though the existing layered defenses (a
-- 5-attempt cap and 10-minute expiry per code, plus the per-phone
-- generation rate limits added since) meaningfully limit real-world
-- exploitability today.
--
-- pgcrypto is already installed and already used by this exact function
-- (extensions.digest() for hashing the code) and elsewhere in this schema
-- (gen_random_bytes() for API keys, biometric device secrets, and the
-- M-Pesa callback_token) for values that need real randomness. Swaps the
-- OTP code generator onto the same source: 4 random bytes -> unsigned
-- 32-bit value -> mod 1,000,000, zero-padded to 6 digits. Same output
-- format and range as before -- no client-visible change.
create or replace function generate_otp(p_phone text, p_purpose text default 'login', p_channel text default 'sms')
returns text
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_code text;
  v_last_request timestamptz;
  v_requests_24h integer;
begin
  select max(created_at) into v_last_request
    from otp_codes where phone = p_phone and purpose = p_purpose and channel = p_channel;
  if v_last_request is not null and v_last_request > now() - interval '60 seconds' then
    raise exception 'Please wait before requesting another code.';
  end if;

  select count(*) into v_requests_24h
    from otp_codes where phone = p_phone and purpose = p_purpose and channel = p_channel and created_at > now() - interval '24 hours';
  if v_requests_24h >= 10 then
    raise exception 'Too many code requests for this number today. Try again later.';
  end if;

  v_code := lpad((('x' || encode(extensions.gen_random_bytes(4), 'hex'))::bit(32)::bigint % 1000000)::text, 6, '0');

  update otp_codes
  set consumed_at = now()
  where phone = p_phone
    and purpose = p_purpose
    and channel = p_channel
    and consumed_at is null;

  insert into otp_codes (phone, purpose, code_hash, expires_at, channel)
  values (p_phone, p_purpose, encode(extensions.digest(v_code, 'sha256'), 'hex'), now() + interval '10 minutes', p_channel);

  return v_code;
end;
$$;

revoke execute on function generate_otp(text, text, text) from public, anon, authenticated;
