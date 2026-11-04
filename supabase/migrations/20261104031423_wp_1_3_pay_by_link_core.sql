-- WP 1.3 Pay by Link (1/2): database core. ADDITIVE ONLY, flag off for every school.
--
-- A finance user creates a tokenised, expiring link for one student and a fixed amount. The payer
-- opens a public page, types their own M-Pesa number and the EXISTING STK push flow is used
-- (mpesa-stk-push, mpesa-stk-callback, mpesa_stk_callback_confirm are NOT changed). This migration
-- only adds: one flag, two tables, and functions. No existing function, table, policy, trigger,
-- constraint or grant is edited.
--
-- Safety model:
--   * only a SHA-256 hash of the token is stored; the token is shown once, at creation
--   * the amount is fixed by staff at creation (no balance is read or shown to the payer)
--   * default lifetime 48 hours (max 14 days); a failed or cancelled prompt does not use the link up,
--     a completed payment does (computed from the attempts, so the callback needs no change)
--   * public-side functions are service_role only (called by a server route, never by anon)
--   * rate limits: per link, per IP and per phone (the phone bucket is the SAME bucket the staff
--     STK push uses, so the two paths share one cap)
--   * nothing here sends any SMS/WhatsApp; staff copy the link themselves in v1

-- 1. Flag catalog entry (not enabled for anyone).
insert into public.platform_feature_flags (key, label, description)
select 'feature.finance.pay_by_link',
       'Pay by Link (M-Pesa)',
       'Finance staff create an expiring pay link for a student; the payer opens it and approves an M-Pesa STK prompt on their own phone. Off by default.'
where not exists (select 1 from public.platform_feature_flags where lower(key) = 'feature.finance.pay_by_link');

-- 2. Links.
create table if not exists public.pay_links (
  id uuid primary key default gen_random_uuid(),
  school_id uuid not null references public.schools(id) on delete cascade,
  student_id uuid not null references public.students(id) on delete cascade,
  invoice_id uuid references public.invoices(id) on delete set null,
  amount numeric(10, 2) not null check (amount > 0 and amount <= 150000),
  token_hash text not null unique check (token_hash ~ '^[0-9a-f]{64}$'),
  expires_at timestamptz not null,
  revoked_at timestamptz,
  created_by uuid references public.school_users(id) on delete set null,
  created_at timestamptz not null default now()
);
comment on table public.pay_links is 'Pay by Link: one row per link. Only the SHA-256 hash of the token is stored. Written only by create_pay_link() / revoke_pay_link().';
create index if not exists pay_links_school_student on public.pay_links (school_id, student_id, created_at desc);

-- 3. Payment attempts made through a link (one row per STK request raised from the link).
create table if not exists public.pay_link_attempts (
  id uuid primary key default gen_random_uuid(),
  link_id uuid not null references public.pay_links(id) on delete cascade,
  school_id uuid not null references public.schools(id) on delete cascade,
  stk_request_id uuid not null unique references public.mpesa_stk_requests(id) on delete cascade,
  created_at timestamptz not null default now()
);
comment on table public.pay_link_attempts is 'Links an STK request to the pay link that raised it. Written only by pay_link_begin_payment().';
create index if not exists pay_link_attempts_link on public.pay_link_attempts (link_id, created_at desc);

alter table public.pay_links enable row level security;
alter table public.pay_link_attempts enable row level security;

-- Staff with finance.read may see their own school's links (never the token hash: column grant below).
drop policy if exists pay_links_select on public.pay_links;
create policy pay_links_select on public.pay_links for select
  using (school_id = public.auth_school_id() and public.auth_has_permission('finance.read'));
drop policy if exists pay_link_attempts_select on public.pay_link_attempts;
create policy pay_link_attempts_select on public.pay_link_attempts for select
  using (school_id = public.auth_school_id() and public.auth_has_permission('finance.read'));

revoke all on public.pay_links from public, anon, authenticated;
revoke all on public.pay_link_attempts from public, anon, authenticated;
grant select (id, school_id, student_id, invoice_id, amount, expires_at, revoked_at, created_by, created_at)
  on public.pay_links to authenticated;
grant select on public.pay_link_attempts to authenticated;

create trigger trg_audit_pay_links
  after insert or update or delete on public.pay_links
  for each row execute function public.audit_row_change();

-- 4. Staff: create a link. Returns the token ONCE (it is not recoverable afterwards).
create or replace function public.create_pay_link(
  p_student_id uuid,
  p_amount numeric,
  p_invoice_id uuid default null,
  p_ttl_hours integer default 48
)
returns table (link_id uuid, token text, expires_at timestamptz)
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_school uuid := public.auth_school_id();
  v_actor uuid;
  v_token text;
  v_id uuid;
  v_exp timestamptz;
begin
  if v_school is null or not public.auth_has_permission('finance.write') then
    raise exception 'Not authorized to create pay links.';
  end if;
  if not public.my_school_has_feature_flag('feature.finance.pay_by_link') then
    raise exception 'Pay by Link is not enabled for this school.';
  end if;
  if p_amount is null or p_amount <= 0 or p_amount > 150000 then
    raise exception 'Amount must be between 1 and 150000.';
  end if;
  if p_ttl_hours is null or p_ttl_hours < 1 or p_ttl_hours > 336 then
    raise exception 'Link lifetime must be between 1 hour and 14 days.';
  end if;
  if not exists (select 1 from public.students where id = p_student_id and school_id = v_school) then
    raise exception 'Student not found in your school.';
  end if;
  if p_invoice_id is not null and not exists (
    select 1 from public.invoices where id = p_invoice_id and student_id = p_student_id and school_id = v_school
  ) then
    raise exception 'Invoice does not belong to this student.';
  end if;
  if not exists (select 1 from public.mpesa_settings where school_id = v_school and is_active = true) then
    raise exception 'M-Pesa is not activated for this school yet.';
  end if;

  select su.id into v_actor from public.school_users su
    where su.auth_user_id = auth.uid() and su.status = 'active';
  if v_actor is null then
    raise exception 'No active school user for the current session.';
  end if;

  if not public.increment_and_check_rate_limit('pay-link-create:' || v_actor::text, 30, 3600) then
    raise exception 'Too many pay links created in the last hour. Try again shortly.';
  end if;

  -- 64 hex characters from two random UUIDs (built in; no extension needed).
  v_token := replace(gen_random_uuid()::text, '-', '') || replace(gen_random_uuid()::text, '-', '');
  v_exp := now() + make_interval(hours => p_ttl_hours);

  insert into public.pay_links (school_id, student_id, invoice_id, amount, token_hash, expires_at, created_by)
  values (v_school, p_student_id, p_invoice_id, round(p_amount, 2),
          encode(sha256(convert_to(v_token, 'UTF8')), 'hex'), v_exp, v_actor)
  returning id into v_id;

  return query select v_id, v_token, v_exp;
end;
$function$;
revoke all on function public.create_pay_link(uuid, numeric, uuid, integer) from public, anon;
grant execute on function public.create_pay_link(uuid, numeric, uuid, integer) to authenticated, service_role;

-- 5. Staff: revoke a link.
create or replace function public.revoke_pay_link(p_link_id uuid)
returns void
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_school uuid := public.auth_school_id();
begin
  if v_school is null or not public.auth_has_permission('finance.write') then
    raise exception 'Not authorized to revoke pay links.';
  end if;
  update public.pay_links set revoked_at = now()
   where id = p_link_id and school_id = v_school and revoked_at is null;
  if not found then
    raise exception 'Pay link not found or already revoked.';
  end if;
end;
$function$;
revoke all on function public.revoke_pay_link(uuid) from public, anon;
grant execute on function public.revoke_pay_link(uuid) to authenticated, service_role;

-- 6. Public side (service_role only). State of a link, by token hash. status is one of:
--    valid | expired | used | revoked | invalid. Every non-valid state is shown to the payer as the same
--    neutral message by the route; the distinction exists for tests and staff diagnostics only.
create or replace function public.pay_link_public_view(p_token_hash text)
returns table (status text, school_name text, student_first_name text, amount numeric)
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_link record;
begin
  select l.*, s.name as school_name, st.first_name as student_first_name
    into v_link
    from public.pay_links l
    join public.schools s on s.id = l.school_id
    join public.students st on st.id = l.student_id
   where l.token_hash = p_token_hash;

  if v_link.id is null
     or not public.school_has_feature_flag(v_link.school_id, 'feature.finance.pay_by_link')
     or not exists (select 1 from public.mpesa_settings where school_id = v_link.school_id and is_active = true) then
    return query select 'invalid'::text, null::text, null::text, null::numeric;
    return;
  end if;
  if v_link.revoked_at is not null then
    return query select 'revoked'::text, null::text, null::text, null::numeric;
    return;
  end if;
  if exists (
    select 1 from public.pay_link_attempts a
      join public.mpesa_stk_requests r on r.id = a.stk_request_id
     where a.link_id = v_link.id and r.status = 'completed'
  ) then
    return query select 'used'::text, null::text, null::text, null::numeric;
    return;
  end if;
  if v_link.expires_at <= now() then
    return query select 'expired'::text, null::text, null::text, null::numeric;
    return;
  end if;
  return query select 'valid'::text, v_link.school_name::text, v_link.student_first_name::text, v_link.amount;
end;
$function$;
revoke all on function public.pay_link_public_view(text) from public, anon, authenticated;
grant execute on function public.pay_link_public_view(text) to service_role;

-- 7. Public side (service_role only). Raise a pending STK request for a valid link and the payer's
--    own number. The route then invokes the UNCHANGED mpesa-stk-push with that request id.
create or replace function public.pay_link_begin_payment(p_token_hash text, p_phone text, p_ip text)
returns uuid
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_link_id uuid;
  v_status text;
  v_request_id uuid;
begin
  if p_phone is null or p_phone !~ '^254[17][0-9]{8}$' then
    raise exception 'INVALID_PHONE';
  end if;

  select id into v_link_id from public.pay_links where token_hash = p_token_hash for update;
  if v_link_id is null then
    raise exception 'LINK_NOT_AVAILABLE';
  end if;

  select v.status into v_status from public.pay_link_public_view(p_token_hash) v;
  if v_status is distinct from 'valid' then
    raise exception 'LINK_NOT_AVAILABLE';
  end if;

  if not public.increment_and_check_rate_limit('pay-link:' || p_token_hash, 5, 3600)
     or not public.increment_and_check_rate_limit('pay-link-ip:' || coalesce(p_ip, 'unknown'), 20, 3600)
     or not public.increment_and_check_rate_limit('mpesa-stk-phone:' || p_phone, 5, 3600) then
    raise exception 'RATE_LIMITED';
  end if;

  -- One prompt at a time: do not raise another while a recent one is still waiting for the payer.
  if exists (
    select 1 from public.pay_link_attempts a
      join public.mpesa_stk_requests r on r.id = a.stk_request_id
     where a.link_id = v_link_id and r.status = 'pending' and r.initiated_at > now() - interval '2 minutes'
  ) then
    raise exception 'PROMPT_IN_PROGRESS';
  end if;

  insert into public.mpesa_stk_requests (school_id, student_id, invoice_id, amount, phone_number, initiated_by, notes)
  select l.school_id, l.student_id, l.invoice_id, l.amount, p_phone, l.created_by, 'Pay by Link'
    from public.pay_links l where l.id = v_link_id
  returning id into v_request_id;

  insert into public.pay_link_attempts (link_id, school_id, stk_request_id)
  select l.id, l.school_id, v_request_id from public.pay_links l where l.id = v_link_id;

  return v_request_id;
end;
$function$;
revoke all on function public.pay_link_begin_payment(text, text, text) from public, anon, authenticated;
grant execute on function public.pay_link_begin_payment(text, text, text) to service_role;

-- 8. Public side (service_role only). Status of one attempt, only if it belongs to the link.
create or replace function public.pay_link_attempt_status(p_token_hash text, p_request_id uuid)
returns text
language sql
stable
security definer
set search_path to 'public'
as $function$
  select r.status
    from public.pay_link_attempts a
    join public.pay_links l on l.id = a.link_id
    join public.mpesa_stk_requests r on r.id = a.stk_request_id
   where l.token_hash = p_token_hash and a.stk_request_id = p_request_id;
$function$;
revoke all on function public.pay_link_attempt_status(text, uuid) from public, anon, authenticated;
grant execute on function public.pay_link_attempt_status(text, uuid) to service_role;

-- Rollback: the flag is off for everyone, so switching it off is the rollback. To remove the objects:
--   drop function pay_link_attempt_status, pay_link_begin_payment, pay_link_public_view, revoke_pay_link, create_pay_link;
--   drop table pay_link_attempts, pay_links; delete the flag catalog row.
