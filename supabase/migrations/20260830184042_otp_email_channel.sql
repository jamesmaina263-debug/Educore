-- Reconciles migration history for 20260830184042 (otp_email_channel).
--
-- Applied directly to production out-of-band on 2026-08-30 without a
-- committed file, which blocks `supabase db push` for everyone with
-- "Remote migration versions not found in local migrations directory"
-- (same situation as 20260830120956_platform_admin_notifications.sql).
--
-- This file documents what is already live, verified against production
-- via direct introspection (pg_get_functiondef, information_schema),
-- not assumed:
--   - otp_codes gained a `channel` column (text, not null, default 'sms',
--     check in ('sms','email')), letting one row represent either an
--     SMS-delivered or email-delivered code.
--   - generate_otp/verify_otp both gained a p_channel parameter. Confirmed
--     these are DROP + CREATE, not CREATE OR REPLACE: appending a
--     parameter changes the function's argument-type signature, and
--     CREATE OR REPLACE in that case would create a second, separately
--     overloaded function alongside the original rather than truly
--     replacing it -- breaking any caller that doesn't pass p_channel
--     (src/app/apply/[slug]/actions.ts calls `verify_otp` directly via
--     named RPC parameters, with no p_channel, and must keep resolving to
--     one single function).
--   - The parameter is still named p_phone, not p_identifier, for the
--     same reason: that actions.ts call uses named-parameter matching
--     (`p_phone: guardianPhone`). p_phone now means "the identifier" -- a
--     phone number when p_channel = 'sms', an email address when
--     p_channel = 'email'.
--   - Same revoke-from-public/anon/authenticated lockdown as every prior
--     generate_otp/verify_otp migration.
--
-- Deliberately NOT included here (and not live): a unique index on
-- school_users(email) mirroring uq_school_users_active_phone. A live-data
-- check before that would-be index was applied found 2 real active
-- parents (different schools) legitimately sharing one email address --
-- forcing uniqueness would have required unilaterally altering live
-- guardian data with no basis for which row to change. verify-otp's
-- school_users lookup already handles a multi-match result gracefully
-- (array-based query, explicit "contact your school office" error, not a
-- crash), so shipping without the index is safe. Revisit only after
-- those specific accounts are reviewed with the schools involved.
alter table otp_codes
  add column channel text not null default 'sms' check (channel in ('sms', 'email'));

drop index if exists idx_otp_codes_lookup;
create index idx_otp_codes_lookup on otp_codes(phone, channel, purpose, expires_at desc);

drop function if exists generate_otp(text, text);
drop function if exists verify_otp(text, text, text);

create function generate_otp(p_phone text, p_purpose text default 'login', p_channel text default 'sms')
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

  v_code := lpad(floor(random() * 1000000)::text, 6, '0');

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

create function verify_otp(p_phone text, p_code text, p_purpose text default 'login', p_channel text default 'sms')
returns boolean
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_row otp_codes%rowtype;
begin
  select * into v_row
  from otp_codes
  where phone = p_phone
    and purpose = p_purpose
    and channel = p_channel
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

revoke execute on function generate_otp(text, text, text) from public, anon, authenticated;
revoke execute on function verify_otp(text, text, text, text) from public, anon, authenticated;
