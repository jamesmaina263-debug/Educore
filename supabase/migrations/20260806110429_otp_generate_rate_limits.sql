-- OTP brute-force protection audit (Gap Analysis Tier 1 #18). Found already
-- substantially in place: verify_otp() caps at 5 attempts per code
-- (verified live -- a 6th attempt is rejected even with the correct code),
-- and request-otp's edge function enforces a 60s cooldown between requests
-- to stop SMS-bombing. The real gap: that cooldown lived ONLY in the edge
-- function (application layer), not in generate_otp() itself (the database
-- function is the actual security boundary -- anything with the service-role
-- key, now or in the future, could call it directly and skip the edge
-- function's check entirely). Moving the cooldown into the DB function makes
-- it authoritative, and adding a 24h cap closes the "wait 60s, repeat many
-- times over a day" grinding gap the cooldown alone didn't cover.
create or replace function public.generate_otp(p_phone text, p_purpose text default 'login'::text)
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
    from otp_codes where phone = p_phone and purpose = p_purpose;
  if v_last_request is not null and v_last_request > now() - interval '60 seconds' then
    raise exception 'Please wait before requesting another code.';
  end if;

  select count(*) into v_requests_24h
    from otp_codes where phone = p_phone and purpose = p_purpose and created_at > now() - interval '24 hours';
  if v_requests_24h >= 10 then
    raise exception 'Too many code requests for this number today. Try again later.';
  end if;

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
