create table public.mpesa_settings (
  school_id uuid primary key references public.schools(id) on delete cascade,
  shortcode text,
  shortcode_type text check (shortcode_type in ('paybill', 'till')),
  environment text not null default 'sandbox' check (environment in ('sandbox', 'production')),
  callback_token text not null default encode(gen_random_bytes(24), 'hex'),
  is_active boolean not null default false,
  updated_at timestamptz not null default now(),
  updated_by uuid references public.school_users(id)
);

alter table public.mpesa_settings enable row level security;

create trigger trg_mpesa_settings_updated_at
  before update on public.mpesa_settings
  for each row execute function public.set_updated_at();

create trigger trg_audit_mpesa_settings
  after insert or update or delete on public.mpesa_settings
  for each row execute function public.audit_row_change();

create table public.mpesa_credentials (
  school_id uuid primary key references public.schools(id) on delete cascade,
  consumer_key text not null,
  consumer_secret text not null,
  passkey text not null,
  updated_at timestamptz not null default now(),
  updated_by uuid references public.school_users(id)
);

alter table public.mpesa_credentials enable row level security;

create trigger trg_mpesa_credentials_updated_at
  before update on public.mpesa_credentials
  for each row execute function public.set_updated_at();

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

create index idx_mpesa_stk_requests_school_id on public.mpesa_stk_requests(school_id, initiated_at desc);
create index idx_mpesa_stk_requests_student_id on public.mpesa_stk_requests(student_id);
create index idx_mpesa_stk_requests_status on public.mpesa_stk_requests(school_id, status) where status = 'pending';

alter table public.mpesa_stk_requests enable row level security;

create trigger trg_audit_mpesa_stk_requests
  after insert or update or delete on public.mpesa_stk_requests
  for each row execute function public.audit_row_change();

insert into public.role_permissions (role_id, school_id, permission_key, allowed)
select r.id, null, 'mpesa.manage', true
from public.roles r
where r.name in ('school_owner', 'principal', 'deputy_principal')
on conflict do nothing;

create policy mpesa_settings_select on public.mpesa_settings
for select
using (
  public.auth_is_super_admin()
  or (school_id = public.auth_school_id() and public.auth_has_permission('finance.read'))
);

create policy mpesa_stk_requests_select on public.mpesa_stk_requests
for select
using (
  public.auth_is_super_admin()
  or (school_id = public.auth_school_id() and public.auth_has_permission('finance.read'))
);

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

  insert into public.mpesa_settings (school_id, shortcode, shortcode_type, environment, updated_by)
  values (v_school_id, p_shortcode, p_shortcode_type, p_environment, v_actor)
  on conflict (school_id) do update
    set shortcode = excluded.shortcode,
        shortcode_type = excluded.shortcode_type,
        environment = excluded.environment,
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
grant execute on function public.set_mpesa_credentials(text, text, text, text, text, text) to authenticated;

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
grant execute on function public.set_mpesa_active(boolean) to authenticated;

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
grant execute on function public.initiate_mpesa_stk_request(uuid, numeric, text, uuid, text) to authenticated;

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
  where id = p_request_id and status = 'pending';

  if not found then
    raise exception 'STK request not found or already resolved.';
  end if;
end;
$function$;
revoke all on function public.mpesa_stk_request_dispatched(uuid, text, text) from public;
grant execute on function public.mpesa_stk_request_dispatched(uuid, text, text) to authenticated, service_role;

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
grant execute on function public.mpesa_stk_dispatch_failed(uuid, text) to authenticated, service_role;

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
    return;
  end if;

  if p_result_code <> 0 then
    update public.mpesa_stk_requests
    set status = 'failed', result_code = p_result_code, result_desc = p_result_desc, resolved_at = now()
    where id = v_request.id;
    return;
  end if;

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
grant execute on function public.mpesa_stk_callback_confirm(text, integer, text, text, numeric, text) to service_role;
