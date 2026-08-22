-- M-Pesa STK Push (item 4 of the current build order).
--
-- This is genuinely production-capable infrastructure, not a stub -- but it stays entirely
-- inert for every school until that school's own credentials are entered and switched on in
-- Integrations > M-Pesa. Unlike SMS/email (one shared Anthropic-style provider, swapped via
-- env vars), M-Pesa is inherently per-school: each school has its own Safaricom Paybill/Till
-- and Daraja app credentials, so "activation" is a per-school row, not a global switch.
--
-- Secrets never touch RLS-readable tables. mpesa_credentials has RLS enabled with ZERO select
-- policies for any role except service_role/postgres -- not even the owning school's finance
-- staff can read them back once saved (same "write-only, never re-displayed" principle as an
-- API key). Only edge functions (using the service-role key, which bypasses RLS entirely --
-- see supabase/functions/request-otp for the existing precedent) ever read them, to make the
-- actual Daraja calls. mpesa_settings holds everything that's safe to display (shortcode,
-- environment, is_active) and does have normal RLS.
--
-- payments.status already includes 'pending' and 'unallocated', and payments.source already
-- includes 'api' -- both were added ahead of time for exactly this (see
-- 20260731064857_finance_payments.sql's own comment on mpesa_checkout_request_id). No change
-- needed to that table's shape, only new rows using values it already allows.

-- ============================================================
-- mpesa_settings: per-school, non-secret, readable by finance staff.
-- ============================================================
create table public.mpesa_settings (
  id uuid not null default gen_random_uuid(),
  school_id uuid primary key references public.schools(id) on delete cascade,
  shortcode text,
  shortcode_type text check (shortcode_type in ('paybill', 'till')),
  environment text not null default 'sandbox' check (environment in ('sandbox', 'production')),
  -- Random per-school path segment embedded in the callback URL we give Safaricom. Daraja
  -- callbacks carry no custom headers/auth we control, so this is the standard real-world
  -- mitigation: the URL itself is the shared secret. Never displayed back in the UI once set.
  callback_token text not null default encode(gen_random_bytes(24), 'hex'),
  -- Non-secret signal only: "have credentials ever been saved", set by
  -- set_mpesa_credentials() itself. Needed because mpesa_credentials has zero select
  -- policies -- without this, the settings UI could never distinguish "never saved
  -- credentials" from "saved but not yet activated".
  credentials_saved boolean not null default false,
  is_active boolean not null default false,
  updated_at timestamptz not null default now(),
  updated_by uuid references public.school_users(id)
);
comment on table public.mpesa_settings is
  'Per-school M-Pesa configuration, non-secret fields only. is_active gates every push -- stays false until a school''s admin has entered real credentials and explicitly turned it on (see set_mpesa_credentials / set_mpesa_active). id exists alongside the school_id primary key solely because audit_row_change() (Phase 17) requires a plain "id" column on every table it triggers on -- school_id remains the actual key everything else references.';

alter table public.mpesa_settings enable row level security;

create trigger trg_mpesa_settings_updated_at
  before update on public.mpesa_settings
  for each row execute function public.set_updated_at();

create trigger trg_audit_mpesa_settings
  after insert or update or delete on public.mpesa_settings
  for each row execute function public.audit_row_change();

-- ============================================================
-- mpesa_credentials: secrets. RLS enabled, NO policies at all -- see header comment.
-- ============================================================
create table public.mpesa_credentials (
  school_id uuid primary key references public.schools(id) on delete cascade,
  consumer_key text not null,
  consumer_secret text not null,
  passkey text not null,
  updated_at timestamptz not null default now(),
  updated_by uuid references public.school_users(id)
);
comment on table public.mpesa_credentials is
  'Daraja app secrets. RLS enabled with zero select policies -- unreadable via the REST API by any role except service_role. Written only by set_mpesa_credentials(); read only by edge functions using the service-role key (bypasses RLS by design, same as every other secret-touching edge function in this repo).';

alter table public.mpesa_credentials enable row level security;

create trigger trg_mpesa_credentials_updated_at
  before update on public.mpesa_credentials
  for each row execute function public.set_updated_at();

-- No audit trigger on this table -- audit_row_change() would capture consumer_secret/passkey
-- in new_data/old_data, defeating the whole point of locking the table down.

-- ============================================================
-- mpesa_stk_requests: every push attempt, successful or not.
-- ============================================================
create table public.mpesa_stk_requests (
  id uuid primary key default gen_random_uuid(),
  school_id uuid not null references public.schools(id) on delete cascade,
  student_id uuid not null references public.students(id),
  invoice_id uuid references public.invoices(id),
  amount numeric(10,2) not null check (amount > 0),
  phone_number text not null,
  merchant_request_id text,
  checkout_request_id text unique,
  status text not null default 'pending' check (status in ('pending', 'completed', 'failed', 'cancelled')),
  result_code integer,
  result_desc text,
  payment_id uuid references public.payments(id),
  initiated_by uuid not null references public.school_users(id),
  initiated_at timestamptz not null default now(),
  resolved_at timestamptz,
  notes text
);
comment on table public.mpesa_stk_requests is
  'One row per STK push attempt. checkout_request_id is set once Safaricom''s initiate call returns it, and is the idempotency key the callback matches against -- Safaricom retries callbacks, so mpesa_stk_callback_confirm() must be safe to call twice for the same checkout_request_id.';

create index idx_mpesa_stk_requests_school_id on public.mpesa_stk_requests(school_id, initiated_at desc);
create index idx_mpesa_stk_requests_student_id on public.mpesa_stk_requests(student_id);
create index idx_mpesa_stk_requests_status on public.mpesa_stk_requests(school_id, status) where status = 'pending';

alter table public.mpesa_stk_requests enable row level security;

create trigger trg_audit_mpesa_stk_requests
  after insert or update or delete on public.mpesa_stk_requests
  for each row execute function public.audit_row_change();

-- ============================================================
-- Permission: mpesa.manage (settings/credentials), reuse finance.write (initiating a push is
-- fundamentally "recording money coming in", same tier as record_payment).
-- ============================================================
insert into public.role_permissions (role_id, school_id, permission_key, allowed)
select r.id, null, 'mpesa.manage', true
from public.roles r
where r.name in ('school_owner', 'principal', 'deputy_principal')
on conflict do nothing;

-- ============================================================
-- RLS
-- ============================================================
create policy mpesa_settings_select on public.mpesa_settings
for select
using (
  public.auth_is_super_admin()
  or (school_id = public.auth_school_id() and public.auth_has_permission('finance.read'))
);
-- No write policy -- set_mpesa_credentials()/set_mpesa_active() are the only write path.

create policy mpesa_stk_requests_select on public.mpesa_stk_requests
for select
using (
  public.auth_is_super_admin()
  or (school_id = public.auth_school_id() and public.auth_has_permission('finance.read'))
);
-- No write policy -- initiate_mpesa_stk_request() / mpesa_stk_request_dispatched() /
-- mpesa_stk_callback_confirm() are the only write path (the latter two are called by edge
-- functions using the service-role key, which bypasses RLS entirely regardless).

-- ============================================================
-- set_mpesa_credentials: upserts secrets + shortcode/environment in one call. Deliberately
-- does not return the row -- caller already has what they typed, nothing to echo back.
-- ============================================================
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
revoke all on function public.set_mpesa_credentials(text, text, text, text, text, text) from public;
revoke execute on function public.set_mpesa_credentials(text, text, text, text, text, text) from anon;
grant execute on function public.set_mpesa_credentials(text, text, text, text, text, text) to authenticated;

-- ============================================================
-- set_mpesa_active: the explicit "go live" switch, separate from saving credentials so a
-- school can save/test before flipping this on. Cannot activate without credentials on file.
-- ============================================================
create or replace function public.set_mpesa_active(p_active boolean)
returns void
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_school_id uuid;
begin
  if not public.auth_has_permission('mpesa.manage') then
    raise exception 'Not authorized to manage M-Pesa settings.';
  end if;
  v_school_id := public.auth_school_id();

  if p_active and not exists (select 1 from public.mpesa_credentials where school_id = v_school_id) then
    raise exception 'Save M-Pesa credentials before activating.';
  end if;
  if not exists (select 1 from public.mpesa_settings where school_id = v_school_id) then
    raise exception 'Save M-Pesa settings before activating.';
  end if;

  update public.mpesa_settings set is_active = p_active where school_id = v_school_id;
end;
$function$;
revoke all on function public.set_mpesa_active(boolean) from public;
revoke execute on function public.set_mpesa_active(boolean) from anon;
grant execute on function public.set_mpesa_active(boolean) to authenticated;

-- ============================================================
-- initiate_mpesa_stk_request: staff-triggered (bursar keys in a phone number and pushes a
-- prompt to it, the common counter-side flow). Just records the *intent* -- the edge function
-- makes the actual Daraja HTTP calls (a DB function cannot) and then calls
-- mpesa_stk_request_dispatched() to attach the checkout_request_id once Safaricom returns one.
-- ============================================================
create or replace function public.initiate_mpesa_stk_request(
  p_student_id uuid,
  p_amount numeric,
  p_phone_number text,
  p_invoice_id uuid default null,
  p_notes text default null
)
returns uuid
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_school_id uuid;
  v_actor uuid;
  v_request_id uuid;
begin
  if not public.auth_has_permission('finance.write') then
    raise exception 'Not authorized to initiate M-Pesa payments.';
  end if;
  if p_amount <= 0 then
    raise exception 'Amount must be positive.';
  end if;
  if not exists (select 1 from public.students where id = p_student_id and school_id = public.auth_school_id()) then
    raise exception 'Student not found in your school.';
  end if;
  if p_invoice_id is not null and not exists (
    select 1 from public.invoices where id = p_invoice_id and student_id = p_student_id
  ) then
    raise exception 'Invoice does not belong to this student.';
  end if;
  if not exists (
    select 1 from public.mpesa_settings where school_id = public.auth_school_id() and is_active = true
  ) then
    raise exception 'M-Pesa is not activated for this school yet.';
  end if;

  v_school_id := public.auth_school_id();
  select su.id into v_actor from public.school_users su
    where su.auth_user_id = auth.uid() and su.status = 'active';
  if v_actor is null then
    raise exception 'No active school user for the current session.';
  end if;

  -- Throttle: a runaway loop or a malicious actor pushing repeated prompts to the same phone
  -- is a real-money abuse vector (each push is a customer-facing STK prompt on someone's
  -- phone), not just a cost concern the way SMS is. Same primitive request-otp already uses.
  if not public.increment_and_check_rate_limit(
    'mpesa-stk-phone:' || p_phone_number, 5, 3600
  ) then
    raise exception 'Too many M-Pesa prompts sent to this number in the last hour.';
  end if;

  insert into public.mpesa_stk_requests (school_id, student_id, invoice_id, amount, phone_number, initiated_by, notes)
  values (v_school_id, p_student_id, p_invoice_id, p_amount, p_phone_number, v_actor, p_notes)
  returning id into v_request_id;

  return v_request_id;
end;
$function$;
revoke all on function public.initiate_mpesa_stk_request(uuid, numeric, text, uuid, text) from public;
revoke execute on function public.initiate_mpesa_stk_request(uuid, numeric, text, uuid, text) from anon;
grant execute on function public.initiate_mpesa_stk_request(uuid, numeric, text, uuid, text) to authenticated;

-- ============================================================
-- mpesa_stk_request_dispatched: edge function calls this right after Daraja's initiate
-- response comes back, to attach the ids it returned. Guards against double-dispatch: without
-- "checkout_request_id is null" here, calling this twice for the same request_id (retry, or
-- the edge function being invoked twice before the callback resolves it) would silently
-- overwrite the first checkout_request_id and could send a second real STK prompt to the
-- customer's phone for the same invoice.
-- ============================================================
create or replace function public.mpesa_stk_request_dispatched(
  p_request_id uuid,
  p_checkout_request_id text,
  p_merchant_request_id text
)
returns void
language plpgsql
security definer
set search_path to 'public'
as $function$
begin
  update public.mpesa_stk_requests
  set checkout_request_id = p_checkout_request_id,
      merchant_request_id = p_merchant_request_id
  where id = p_request_id and status = 'pending' and checkout_request_id is null;

  if not found then
    raise exception 'STK request not found, already resolved, or already dispatched.';
  end if;
end;
$function$;
revoke all on function public.mpesa_stk_request_dispatched(uuid, text, text) from public;
-- Found live during verification (same class of bug as mpesa_stk_callback_confirm below,
-- caught before this function had it too): this function has NO internal
-- ownership/permission check, unlike every other function in this migration. Originally
-- granted to authenticated "for completeness/testing" -- that was a real mistake. Reproduced
-- live: an authenticated user from a completely unrelated school successfully overwrote
-- another school's pending mpesa_stk_requests row (checkout_request_id/merchant_request_id)
-- by UUID, since a SECURITY DEFINER function's own internal UPDATE bypasses RLS regardless of
-- who's allowed to call the function -- only the grant, not RLS, was standing in the way.
-- There is no legitimate reason for a browser session to call this directly; the
-- mpesa-stk-push edge function (service-role key) is the sole real caller and already
-- validated the request via initiate_mpesa_stk_request upstream. Locked to service_role only,
-- same as mpesa_stk_callback_confirm.
revoke execute on function public.mpesa_stk_request_dispatched(uuid, text, text) from anon, authenticated;
grant execute on function public.mpesa_stk_request_dispatched(uuid, text, text) to service_role;

-- ============================================================
-- mpesa_stk_dispatch_failed: edge function calls this if the Daraja initiate call itself
-- errors (bad credentials, network failure, Safaricom-side rejection) so the request doesn't
-- sit at 'pending' forever with no explanation.
-- ============================================================
create or replace function public.mpesa_stk_dispatch_failed(p_request_id uuid, p_reason text)
returns void
language sql
security definer
set search_path to 'public'
as $function$
  update public.mpesa_stk_requests
  set status = 'failed', result_desc = p_reason, resolved_at = now()
  where id = p_request_id and status = 'pending';
$function$;
revoke all on function public.mpesa_stk_dispatch_failed(uuid, text) from public;
-- Same fix as mpesa_stk_request_dispatched above -- no internal ownership check, locked to
-- service_role only.
revoke execute on function public.mpesa_stk_dispatch_failed(uuid, text) from anon, authenticated;
grant execute on function public.mpesa_stk_dispatch_failed(uuid, text) to service_role;

-- ============================================================
-- mpesa_stk_callback_confirm: the webhook path. No auth_has_permission check -- there is no
-- human session on a Safaricom callback. Authorization instead comes from matching a
-- checkout_request_id that this school already legitimately created via
-- initiate_mpesa_stk_request (itself permission-checked) -- the same trust model as an OTP
-- code: possession of the right opaque id stands in for a session. Idempotent: Safaricom
-- retries callbacks, and the unique index on payments.mpesa_checkout_request_id is a hard
-- backstop even if the status-based guard below is ever raced.
-- ============================================================
create or replace function public.mpesa_stk_callback_confirm(
  p_checkout_request_id text,
  p_result_code integer,
  p_result_desc text,
  p_receipt_number text default null,
  p_amount numeric default null,
  p_phone_number text default null
)
returns void
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_request record;
  v_payment_id uuid;
  v_remaining numeric;
  v_outstanding numeric;
  v_invoice record;
begin
  select * into v_request from public.mpesa_stk_requests
    where checkout_request_id = p_checkout_request_id;

  if v_request.id is null then
    raise exception 'No STK request matches this checkout_request_id.';
  end if;
  if v_request.status <> 'pending' then
    -- Idempotent no-op: Safaricom retries, we've already handled this one.
    return;
  end if;

  if p_result_code <> 0 then
    update public.mpesa_stk_requests
    set status = 'failed', result_code = p_result_code, result_desc = p_result_desc, resolved_at = now()
    where id = v_request.id;
    return;
  end if;

  -- Serialize against every other payment-mutating path for this student (record_payment /
  -- allocate_unallocated_payment / reverse_payment all take this same lock).
  perform pg_advisory_xact_lock(hashtext('student_payments:' || v_request.student_id::text));

  perform public.get_or_create_student_financial_account(v_request.student_id);

  select coalesce(sum(
    total_amount
      - coalesce((select sum(amount_allocated) from public.payment_allocations where invoice_id = invoices.id), 0)
      - coalesce((select sum(amount) from public.discounts where invoice_id = invoices.id and status = 'approved'), 0)
  ), 0) into v_outstanding
  from public.invoices
  where student_id = v_request.student_id and school_id = v_request.school_id and status != 'paid';

  if v_outstanding <= 0 then
    -- No invoice to apply this to right now. Unlike record_payment (an interactive action a
    -- bursar can retry), this is money Safaricom has already moved -- it must be captured
    -- somehow. Land it as an unallocated payment (same shape record_unallocated_payment
    -- produces) rather than raising and losing the record entirely.
    insert into public.payments (school_id, student_id, method, amount, reference, phone_number, mpesa_checkout_request_id, recorded_by, status, source, external_provider, notes)
    values (v_request.school_id, null, 'mpesa', coalesce(p_amount, v_request.amount), p_receipt_number, coalesce(p_phone_number, v_request.phone_number), p_checkout_request_id, v_request.initiated_by, 'unallocated', 'api', 'mpesa_daraja', v_request.notes)
    returning id into v_payment_id;

    insert into public.audit_log (school_id, actor_school_user_id, table_name, record_id, action, new_data)
    values (v_request.school_id, v_request.initiated_by, 'payments', v_payment_id, 'create',
      jsonb_build_object('student_id_intended', v_request.student_id, 'method', 'mpesa', 'amount', coalesce(p_amount, v_request.amount), 'reference', p_receipt_number, 'unallocated_reason', 'no_outstanding_invoice'));
  else
    insert into public.payments (school_id, student_id, method, amount, reference, phone_number, mpesa_checkout_request_id, recorded_by, status, source, external_provider, notes)
    values (v_request.school_id, v_request.student_id, 'mpesa', coalesce(p_amount, v_request.amount), p_receipt_number, coalesce(p_phone_number, v_request.phone_number), p_checkout_request_id, v_request.initiated_by, 'confirmed', 'api', 'mpesa_daraja', v_request.notes)
    returning id into v_payment_id;

    v_remaining := coalesce(p_amount, v_request.amount);

    if v_request.invoice_id is not null then
      select least(v_remaining,
        total_amount
          - coalesce((select sum(amount_allocated) from public.payment_allocations where invoice_id = invoices.id), 0)
          - coalesce((select sum(amount) from public.discounts where invoice_id = invoices.id and status = 'approved'), 0)
      ) into v_outstanding
      from public.invoices where id = v_request.invoice_id;
      if v_outstanding > 0 then
        insert into public.payment_allocations (payment_id, invoice_id, amount_allocated, entry_type)
          values (v_payment_id, v_request.invoice_id, v_outstanding, 'allocation');
        v_remaining := v_remaining - v_outstanding;
      end if;
    end if;

    for v_invoice in
      select id, total_amount,
        total_amount - coalesce((select sum(amount_allocated) from public.payment_allocations where invoice_id = invoices.id), 0)
          - coalesce((select sum(amount) from public.discounts where invoice_id = invoices.id and status = 'approved'), 0) as outstanding
      from public.invoices
      where student_id = v_request.student_id and school_id = v_request.school_id and status != 'paid'
      order by created_at asc
    loop
      exit when v_remaining <= 0;
      if v_invoice.outstanding <= 0 then continue; end if;
      declare v_apply numeric := least(v_remaining, v_invoice.outstanding);
      begin
        insert into public.payment_allocations (payment_id, invoice_id, amount_allocated, entry_type) values (v_payment_id, v_invoice.id, v_apply, 'allocation');
        v_remaining := v_remaining - v_apply;
      end;
    end loop;

    insert into public.audit_log (school_id, actor_school_user_id, table_name, record_id, action, new_data)
    values (v_request.school_id, v_request.initiated_by, 'payments', v_payment_id, 'create',
      jsonb_build_object('student_id', v_request.student_id, 'method', 'mpesa', 'amount', coalesce(p_amount, v_request.amount), 'reference', p_receipt_number));

    perform public.generate_receipt(v_payment_id);
  end if;

  update public.mpesa_stk_requests
  set status = 'completed', result_code = p_result_code, result_desc = p_result_desc,
      payment_id = v_payment_id, resolved_at = now()
  where id = v_request.id;
end;
$function$;
revoke all on function public.mpesa_stk_callback_confirm(text, integer, text, text, numeric, text) from public;
-- "revoke all from public" alone does NOT strip the per-role EXECUTE grants Supabase applies
-- automatically to anon/authenticated at function-creation time (a mistake this exact
-- codebase has hit and fixed before -- see 20260728055850_phase0_step2_revoke_anon_execute_explicit.sql
-- and 20260805034002_rollover_function_revoke_anon.sql for precedent). Found live during
-- verification: authenticated could still call this function (it failed on business-logic
-- grounds, not a permission error). Explicit revoke from both roles by name is required.
revoke execute on function public.mpesa_stk_callback_confirm(text, integer, text, text, numeric, text) from anon, authenticated;
-- Called exclusively by the mpesa-stk-callback edge function via the service-role key.
-- Deliberately NOT granted to authenticated -- a signed-in user has no legitimate reason to
-- call this directly, and it bypasses the normal finance.write check by design.
grant execute on function public.mpesa_stk_callback_confirm(text, integer, text, text, numeric, text) to service_role;
