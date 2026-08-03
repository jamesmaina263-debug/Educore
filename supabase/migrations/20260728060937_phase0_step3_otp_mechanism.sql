-- Phase 0, Step 3 (part 2): parent/student OTP mechanism.
-- This table is intentionally reachable only by service_role -- never by
-- anon or authenticated -- since it holds OTP secrets and needs brute-force
-- protection (Part I), not a client-facing RLS policy.

create table otp_codes (
  id uuid primary key default gen_random_uuid(),
  phone text not null,
  purpose text not null default 'login',
  code_hash text not null,
  expires_at timestamptz not null,
  consumed_at timestamptz,
  attempt_count int not null default 0,
  created_at timestamptz not null default now()
);

create index idx_otp_codes_lookup on otp_codes(phone, purpose, expires_at desc);

alter table otp_codes enable row level security;
-- Deliberately zero policies for anon/authenticated: RLS-enabled + no
-- policy = default deny for every non-service_role caller. service_role
-- bypasses RLS entirely, which is the only way this table is ever touched.

-- Generates a 6-digit OTP, invalidates any prior unconsumed code for the
-- same phone+purpose (no stacking valid codes), and returns the plaintext
-- code so the caller (an Edge Function running as service_role) can send
-- it via SMS. The plaintext is never persisted -- only its hash is.
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
  values (p_phone, p_purpose, encode(digest(v_code, 'sha256'), 'hex'), now() + interval '10 minutes');

  return v_code;
end;
$$;

-- Verifies a code: enforces expiry, single-use, and a 5-attempt cap per
-- code (Part I: brute-force protection on OTP endpoints).
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

  if v_row.code_hash <> encode(digest(p_code, 'sha256'), 'hex') then
    update otp_codes set attempt_count = attempt_count + 1 where id = v_row.id;
    return false;
  end if;

  update otp_codes set consumed_at = now() where id = v_row.id;
  return true;
end;
$$;

-- Both functions handle OTP secrets end-to-end; only the backend
-- (service_role, e.g. from an Edge Function) should ever call them.
revoke execute on function generate_otp(text, text) from public, anon, authenticated;
revoke execute on function verify_otp(text, text, text) from public, anon, authenticated;
