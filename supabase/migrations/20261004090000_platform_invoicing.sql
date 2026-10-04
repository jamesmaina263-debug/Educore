-- Platform invoicing (EduCore -> school). Extends the existing platform billing module
-- (subscription_plans / school_subscriptions / platform_invoices, 20260805034029) instead of
-- creating a parallel billing system. This is how EduCore bills a SCHOOL; it is unrelated to
-- the school-level fee invoices parents receive (finance_invoices).
--
-- What this adds:
--   * Visible, sequential invoice numbers (EDC-INV-2026-0001), allocated from a per-year counter.
--   * Draft/issued/sent/partially_paid lifecycle on top of the existing issued/paid/overdue/cancelled.
--   * Immutable calculation + bill-to + payment-instruction snapshots on each invoice.
--   * Payments ledger (partial payments, voids), append-only audit trail.
--   * Central, admin-editable billing settings (singleton) -- no pricing/payment constants in code.
--   * Per-school pricing override / recurring discount / billing email on school_subscriptions.
--   * An automated billing-cycle planner + runner, OFF by default (see platform_billing_settings).
--   * DB-level duplicate/overlap protection (the 2026-09-14 Gititu double-click was caught only by
--     an app-level check-then-insert, which is racy) and a guard so financial columns can only
--     change through the audited functions below, never via a stray direct UPDATE.
--
-- Safety posture for live tenants:
--   * Nothing is auto-generated until a platform admin sets auto_generate_enabled AND an explicit
--     auto_effective_from date. Auto-generated invoices are DRAFTS unless auto_issue is enabled,
--     because an issued invoice that goes overdue suspends the school after the 7-day grace period
--     (suspend_schools_with_overdue_invoices). Drafts are never swept to overdue and are invisible
--     to schools.
--   * Existing invoices are backfilled (number, snapshots, payment row) but their amounts, dates
--     and statuses are not changed.
--   * Idempotent where possible; the whole file runs in one transaction.

-- ============================================================
-- 1. Billing settings (singleton)
-- ============================================================
create table if not exists public.platform_billing_settings (
  id boolean primary key default true check (id),
  invoice_prefix text not null default 'EDC-INV'
    check (invoice_prefix ~ '^[A-Z0-9]{2,10}(-[A-Z0-9]{2,10})*$'),
  payment_terms_days integer not null default 14 check (payment_terms_days between 0 and 120),
  auto_generate_enabled boolean not null default false,
  auto_effective_from date,
  auto_lookback_days integer not null default 45 check (auto_lookback_days between 0 and 366),
  auto_issue boolean not null default false,
  auto_send boolean not null default false,
  billable_student_statuses text[] not null default array['active']::text[],
  tax_enabled boolean not null default false,
  tax_label text not null default 'VAT' check (char_length(tax_label) between 1 and 20),
  tax_rate_percent numeric(5,2) not null default 0 check (tax_rate_percent between 0 and 100),
  payment_instructions jsonb not null default '{}'::jsonb,
  invoice_footer_note text not null default 'Thank you for partnering with EduCore Africa.'
    check (char_length(invoice_footer_note) <= 300),
  updated_at timestamptz not null default now(),
  updated_by uuid,
  constraint platform_billing_settings_statuses_valid check (
    cardinality(billable_student_statuses) > 0
    and billable_student_statuses <@ array['applied','approved','enrolled','active','withdrawn','transferred','graduated']::text[]
  ),
  constraint platform_billing_settings_auto_needs_date check (not auto_generate_enabled or auto_effective_from is not null),
  constraint platform_billing_settings_send_needs_issue check (not auto_send or auto_issue)
);
comment on table public.platform_billing_settings is 'Single row (id = true). Central EduCore billing configuration. Payment instructions are deliberately empty until an administrator enters them -- nothing here is pre-filled with bank/M-Pesa details.';
comment on column public.platform_billing_settings.billable_student_statuses is 'students.status values that count toward an invoice. Default {active} preserves the pre-existing rule used by generate_platform_invoice.';
comment on column public.platform_billing_settings.auto_effective_from is 'Auto-billing only considers terms ending on/after this date, so enabling the feature never back-bills history.';

insert into public.platform_billing_settings (id) values (true) on conflict (id) do nothing;

create table if not exists public.platform_invoice_counters (
  year integer primary key,
  last_value integer not null default 0 check (last_value >= 0)
);
comment on table public.platform_invoice_counters is 'Per-year invoice sequence. Incremented with an upsert inside the invoice-creating transaction, so numbers are unique and gap-free (cancelled invoices keep their number).';

-- ============================================================
-- 2. Per-school pricing terms on the subscription
-- ============================================================
alter table public.school_subscriptions
  add column if not exists price_override_kes numeric check (price_override_kes >= 0),
  add column if not exists recurring_discount_percent numeric(5,2) not null default 0
    check (recurring_discount_percent between 0 and 100),
  add column if not exists discount_note text,
  add column if not exists billing_email text
    check (billing_email is null or billing_email ~* '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$');
comment on column public.school_subscriptions.price_override_kes is 'Custom per-student price for this school. NULL = use the plan price (subscription_plans.price_per_student_kes).';
comment on column public.school_subscriptions.billing_email is 'Where invoices are emailed. NULL falls back to the school owner, then schools.email.';

-- ============================================================
-- 3. platform_invoices: new columns, widened status set
-- ============================================================
alter table public.platform_invoices
  add column if not exists invoice_number text,
  add column if not exists invoice_date date,
  add column if not exists billing_period_label text,
  add column if not exists term_id uuid references public.terms(id) on delete set null,
  add column if not exists plan_id uuid references public.subscription_plans(id) on delete set null,
  add column if not exists plan_name text,
  add column if not exists unit_price_kes numeric check (unit_price_kes >= 0),
  add column if not exists subtotal_kes numeric,
  add column if not exists discount_kes numeric not null default 0 check (discount_kes >= 0),
  add column if not exists tax_label text,
  add column if not exists tax_rate_percent numeric(5,2) not null default 0,
  add column if not exists tax_kes numeric not null default 0 check (tax_kes >= 0),
  add column if not exists amount_paid_kes numeric not null default 0 check (amount_paid_kes >= 0),
  add column if not exists currency text not null default 'KES',
  add column if not exists source text not null default 'manual' check (source in ('manual', 'auto')),
  add column if not exists replaces_invoice_id uuid references public.platform_invoices(id),
  add column if not exists billable_statuses text[],
  add column if not exists bill_to jsonb,
  add column if not exists payment_instructions jsonb,
  add column if not exists notes text check (notes is null or char_length(notes) <= 1000),
  add column if not exists pdf_version integer not null default 0,
  add column if not exists pdf_generated_at timestamptz,
  add column if not exists sent_at timestamptz,
  add column if not exists sent_to text,
  add column if not exists cancelled_at timestamptz,
  add column if not exists cancel_reason text,
  add column if not exists created_by uuid;

comment on column public.platform_invoices.amount_kes is 'TOTAL amount due (subtotal - discount + tax). Name kept for compatibility with existing dashboards.';
comment on column public.platform_invoices.notes is 'Printed on the invoice and visible to the school. Not an internal scratchpad.';
comment on column public.platform_invoices.bill_to is 'Snapshot of the school''s name/address/contact/KRA PIN at creation, so the invoice stays reproducible if the school later edits its profile.';
comment on column public.platform_invoices.payment_instructions is 'Snapshot of platform_billing_settings.payment_instructions taken when the invoice is issued (refreshed on explicit PDF regeneration).';

-- issued_at now means "when it was issued": NULL for drafts. Existing rows keep their value.
alter table public.platform_invoices alter column issued_at drop not null;
alter table public.platform_invoices alter column issued_at drop default;

alter table public.platform_invoices drop constraint if exists platform_invoices_status_check;
alter table public.platform_invoices add constraint platform_invoices_status_check
  check (status in ('draft', 'issued', 'sent', 'partially_paid', 'paid', 'overdue', 'cancelled'));

-- ------------------------------------------------------------
-- Backfill existing invoices (no change to amounts/dates/status)
-- ------------------------------------------------------------
do $$
declare
  r record;
  v_prefix text;
  v_year integer;
  v_seq integer;
begin
  select invoice_prefix into v_prefix from public.platform_billing_settings where id;

  for r in
    select * from public.platform_invoices where invoice_number is null
    order by coalesce(issued_at, created_at), id
  loop
    v_year := extract(year from (coalesce(r.issued_at, r.created_at) at time zone 'Africa/Nairobi'))::integer;
    insert into public.platform_invoice_counters as c (year, last_value) values (v_year, 1)
      on conflict (year) do update set last_value = c.last_value + 1
      returning last_value into v_seq;

    update public.platform_invoices i set
      invoice_number = v_prefix || '-' || v_year || '-' || lpad(v_seq::text, 4, '0'),
      invoice_date = (coalesce(r.issued_at, r.created_at) at time zone 'Africa/Nairobi')::date,
      billing_period_label = to_char(r.period_start, 'FMDD Mon YYYY') || ' – ' || to_char(r.period_end, 'FMDD Mon YYYY'),
      plan_id = (select s.plan_id from public.school_subscriptions s where s.id = r.subscription_id),
      plan_name = (select p.name from public.school_subscriptions s join public.subscription_plans p on p.id = s.plan_id where s.id = r.subscription_id),
      subtotal_kes = r.amount_kes,
      unit_price_kes = case when r.student_count > 0 then round(r.amount_kes / r.student_count, 2) end,
      amount_paid_kes = case when r.status = 'paid' then r.amount_kes else 0 end,
      bill_to = (select jsonb_build_object('school_id', sc.id, 'name', sc.name, 'address', sc.address,
                   'phone', sc.phone, 'email', sc.email, 'kra_pin', sc.kra_pin)
                 from public.schools sc where sc.id = r.school_id),
      source = 'manual'
    where i.id = r.id;
  end loop;
end
$$;

alter table public.platform_invoices
  alter column subtotal_kes set not null,
  alter column invoice_number set not null,
  alter column invoice_date set not null;

alter table public.platform_invoices drop constraint if exists platform_invoices_amount_math;
alter table public.platform_invoices add constraint platform_invoices_amount_math
  check (amount_kes = round(subtotal_kes - discount_kes + tax_kes, 2));
alter table public.platform_invoices drop constraint if exists platform_invoices_paid_within_total;
alter table public.platform_invoices add constraint platform_invoices_paid_within_total
  check (amount_paid_kes <= amount_kes);
alter table public.platform_invoices drop constraint if exists platform_invoices_period_order;
alter table public.platform_invoices add constraint platform_invoices_period_order
  check (period_end >= period_start);

alter table public.platform_invoices
  add column if not exists balance_kes numeric generated always as (amount_kes - amount_paid_kes) stored;

create unique index if not exists platform_invoices_invoice_number_key
  on public.platform_invoices (invoice_number);
-- Exact-duplicate belt-and-braces (the overlap trigger below is the real guard).
create unique index if not exists platform_invoices_school_period_active_key
  on public.platform_invoices (school_id, period_start, period_end) where status <> 'cancelled';
-- One live invoice per school per term, independent of how the term's dates are later edited.
create unique index if not exists platform_invoices_school_term_active_key
  on public.platform_invoices (school_id, term_id) where term_id is not null and status <> 'cancelled';
create index if not exists idx_platform_invoices_school_period on public.platform_invoices (school_id, period_start desc);
create index if not exists idx_platform_invoices_due on public.platform_invoices (due_at) where status in ('issued', 'sent', 'partially_paid', 'overdue');
create index if not exists idx_platform_invoices_term on public.platform_invoices (term_id) where term_id is not null;
create index if not exists idx_platform_invoices_plan on public.platform_invoices (plan_id) where plan_id is not null;
create index if not exists idx_platform_invoices_replaces on public.platform_invoices (replaces_invoice_id) where replaces_invoice_id is not null;

-- ============================================================
-- 4. Payments ledger and audit trail
-- ============================================================
create table if not exists public.platform_invoice_payments (
  id uuid primary key default gen_random_uuid(),
  invoice_id uuid not null references public.platform_invoices(id) on delete restrict,
  school_id uuid not null references public.schools(id),
  amount_kes numeric not null check (amount_kes > 0),
  paid_on date not null,
  method text not null default 'other'
    check (method in ('mpesa', 'bank_transfer', 'cash', 'cheque', 'other', 'unspecified')),
  reference text check (reference is null or char_length(reference) <= 200),
  notes text check (notes is null or char_length(notes) <= 500),
  recorded_by uuid,
  recorded_by_label text,
  voided_at timestamptz,
  voided_reason text,
  created_at timestamptz not null default now()
);
comment on table public.platform_invoice_payments is 'Payments applied to platform invoices. Append-only in spirit: mistakes are voided (voided_at), never deleted. Shaped so a future M-Pesa/bank reconciliation job can insert rows through record_platform_invoice_payment().';
create index if not exists idx_platform_invoice_payments_invoice on public.platform_invoice_payments (invoice_id);
create index if not exists idx_platform_invoice_payments_school on public.platform_invoice_payments (school_id);
create index if not exists idx_platform_invoice_payments_reference on public.platform_invoice_payments (reference) where reference is not null;

create table if not exists public.platform_invoice_events (
  id uuid primary key default gen_random_uuid(),
  invoice_id uuid not null references public.platform_invoices(id) on delete restrict,
  school_id uuid not null references public.schools(id),
  event_type text not null check (event_type in (
    'created', 'generated', 'issued', 'sent', 'send_failed', 'downloaded', 'payment_recorded',
    'payment_voided', 'paid', 'cancelled', 'regenerated', 'reissued', 'adjusted', 'due_date_changed',
    'notes_updated', 'recalculated', 'overdue', 'reminder_sent')),
  actor_user_id uuid,
  actor_label text not null default 'system',
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
comment on table public.platform_invoice_events is 'Append-only invoice audit trail (UPDATE/DELETE are blocked by trigger).';
create index if not exists idx_platform_invoice_events_invoice on public.platform_invoice_events (invoice_id, created_at);
create index if not exists idx_platform_invoice_events_school on public.platform_invoice_events (school_id);

-- Backfill: payment row for legacy paid invoices + a creation event for every legacy invoice.
insert into public.platform_invoice_payments (invoice_id, school_id, amount_kes, paid_on, method, reference, notes, recorded_by_label)
select i.id, i.school_id, i.amount_kes, (i.paid_at at time zone 'Africa/Nairobi')::date, 'unspecified', i.payment_reference,
       'Backfilled from the legacy paid invoice record.', 'system (migration)'
from public.platform_invoices i
where i.status = 'paid' and i.amount_kes > 0 and i.paid_at is not null
  and not exists (select 1 from public.platform_invoice_payments p where p.invoice_id = i.id);

insert into public.platform_invoice_events (invoice_id, school_id, event_type, actor_label, metadata)
select i.id, i.school_id, 'created', 'system (migration)', jsonb_build_object('backfilled', true, 'legacy_status', i.status)
from public.platform_invoices i
where not exists (select 1 from public.platform_invoice_events e where e.invoice_id = i.id);

-- ============================================================
-- 5. RLS
-- ============================================================
alter table public.platform_billing_settings enable row level security;
alter table public.platform_invoice_counters enable row level security;
alter table public.platform_invoice_payments enable row level security;
alter table public.platform_invoice_events enable row level security;

drop policy if exists platform_billing_settings_select on public.platform_billing_settings;
create policy platform_billing_settings_select on public.platform_billing_settings
  for select to authenticated using (auth_is_super_admin());

-- Counters: RLS on, no policies => no client access at all (definer functions only).

drop policy if exists platform_invoice_payments_select on public.platform_invoice_payments;
create policy platform_invoice_payments_select on public.platform_invoice_payments
  for select to authenticated using (auth_is_super_admin());

drop policy if exists platform_invoice_events_select on public.platform_invoice_events;
create policy platform_invoice_events_select on public.platform_invoice_events
  for select to authenticated using (auth_is_super_admin());

-- platform_invoices: writes now happen ONLY through the SECURITY DEFINER functions below
-- (which authorize and audit). The previous blanket super-admin INSERT/UPDATE/DELETE policies
-- are removed. Schools read only their own, non-draft invoices.
drop policy if exists platform_invoices_insert on public.platform_invoices;
drop policy if exists platform_invoices_update on public.platform_invoices;
drop policy if exists platform_invoices_delete on public.platform_invoices;
drop policy if exists platform_invoices_manage on public.platform_invoices;
drop policy if exists platform_invoices_select on public.platform_invoices;
create policy platform_invoices_select on public.platform_invoices
  for select to authenticated
  using (
    auth_is_super_admin()
    or (school_id = auth_school_id() and status <> 'draft' and auth_has_permission('billing.read'))
  );

revoke insert, update, delete, truncate on public.platform_invoices from anon, authenticated;
revoke all on public.platform_billing_settings from anon, authenticated;
grant select on public.platform_billing_settings to authenticated;
revoke all on public.platform_invoice_counters from anon, authenticated;
revoke all on public.platform_invoice_payments from anon, authenticated;
grant select on public.platform_invoice_payments to authenticated;
revoke all on public.platform_invoice_events from anon, authenticated;
grant select on public.platform_invoice_events to authenticated;

-- ============================================================
-- 6. Guards (triggers)
-- ============================================================
-- Financial columns, status and dates can only change inside the invoicing functions, which set
-- the flag (set_config(..., is_local => true), so it never outlives the calling RPC's own
-- transaction). A direct UPDATE (SQL editor, a stray service-role call, a future
-- bug) is rejected. Non-financial columns (e.g. reminder_sent_at) are not guarded.
create or replace function public.platform_invoices_guard()
returns trigger
language plpgsql
set search_path to 'public'
as $$
begin
  if tg_op = 'DELETE' then
    raise exception 'Invoices cannot be deleted. Cancel the invoice instead.' using errcode = '42501';
  end if;
  if coalesce(current_setting('educore.invoice_write', true), '') = 'on' then
    return new;
  end if;
  if tg_op = 'INSERT' then
    raise exception 'Invoices must be created through the invoicing functions.' using errcode = '42501';
  end if;
  if (new.school_id, new.invoice_number, new.period_start, new.period_end, new.student_count,
      new.unit_price_kes, new.subtotal_kes, new.discount_kes, new.tax_kes, new.amount_kes,
      new.amount_paid_kes, new.invoice_date, new.status, new.due_at, new.paid_at, new.cancelled_at, new.source)
     is distinct from
     (old.school_id, old.invoice_number, old.period_start, old.period_end, old.student_count,
      old.unit_price_kes, old.subtotal_kes, old.discount_kes, old.tax_kes, old.amount_kes,
      old.amount_paid_kes, old.invoice_date, old.status, old.due_at, old.paid_at, old.cancelled_at, old.source) then
    raise exception 'Financial fields on an invoice can only be changed through the invoicing functions.' using errcode = '42501';
  end if;
  return new;
end;
$$;
drop trigger if exists trg_platform_invoices_guard on public.platform_invoices;
create trigger trg_platform_invoices_guard
  before insert or update or delete on public.platform_invoices
  for each row execute function public.platform_invoices_guard();

-- Overlap protection, serialised per school with an advisory lock so two concurrent requests
-- (double-click, cron racing an admin) cannot both pass the check.
create or replace function public.platform_invoices_no_overlap()
returns trigger
language plpgsql
set search_path to 'public'
as $$
declare
  v_other text;
begin
  if new.status = 'cancelled' then
    return new;
  end if;
  perform pg_advisory_xact_lock(hashtextextended('platform_invoice:' || new.school_id::text, 0));
  select i.invoice_number into v_other
    from public.platform_invoices i
    where i.school_id = new.school_id
      and i.id <> new.id
      and i.status <> 'cancelled'
      and i.period_start < new.period_end
      and i.period_end > new.period_start
    limit 1;
  if v_other is not null then
    raise exception 'An invoice (%) already exists for this school covering an overlapping period. Cancel it first if it was a mistake, or choose a non-overlapping period.', v_other
      using errcode = '23P01';
  end if;
  return new;
end;
$$;
drop trigger if exists trg_platform_invoices_no_overlap on public.platform_invoices;
create trigger trg_platform_invoices_no_overlap
  before insert or update of period_start, period_end, status, school_id on public.platform_invoices
  for each row execute function public.platform_invoices_no_overlap();

create or replace function public.platform_invoice_events_append_only()
returns trigger
language plpgsql
set search_path to 'public'
as $$
begin
  raise exception 'platform_invoice_events is append-only.' using errcode = '42501';
end;
$$;
drop trigger if exists trg_platform_invoice_events_append_only on public.platform_invoice_events;
create trigger trg_platform_invoice_events_append_only
  before update or delete on public.platform_invoice_events
  for each row execute function public.platform_invoice_events_append_only();

revoke all on function public.platform_invoices_guard() from public, anon, authenticated;
revoke all on function public.platform_invoices_no_overlap() from public, anon, authenticated;
revoke all on function public.platform_invoice_events_append_only() from public, anon, authenticated;

-- ============================================================
-- 7. Internal helpers (not callable by clients)
-- ============================================================
create or replace function public._platform_invoice_event(p_invoice_id uuid, p_type text, p_metadata jsonb default '{}'::jsonb)
returns void
language plpgsql
security definer
set search_path to 'public'
as $$
begin
  insert into public.platform_invoice_events (invoice_id, school_id, event_type, actor_user_id, actor_label, metadata)
  select i.id, i.school_id, p_type, auth.uid(), coalesce(auth.email(), 'system'), coalesce(p_metadata, '{}'::jsonb)
  from public.platform_invoices i where i.id = p_invoice_id;
end;
$$;

create or replace function public._platform_invoice_write_on()
returns void
language sql
as $$ select set_config('educore.invoice_write', 'on', true); $$;

create or replace function public._platform_invoice_status_for(
  p_amount numeric, p_paid numeric, p_due_at timestamptz, p_sent_at timestamptz
) returns text
language sql
stable
as $$
  select case
    when p_paid > 0 and p_paid >= p_amount then 'paid'
    when p_amount - p_paid > 0 and p_due_at < now() then 'overdue'
    when p_paid > 0 then 'partially_paid'
    when p_sent_at is not null then 'sent'
    else 'issued'
  end;
$$;

create or replace function public._platform_invoice_due_at(p_invoice_date date, p_days integer)
returns timestamptz
language sql
immutable
as $$ select ((p_invoice_date + p_days)::timestamp + time '23:59:59') at time zone 'Africa/Nairobi'; $$;

create or replace function public._platform_invoice_quote(p_school_id uuid)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_set public.platform_billing_settings%rowtype;
  v_sub public.school_subscriptions%rowtype;
  v_plan public.subscription_plans%rowtype;
  v_count integer;
  v_unit numeric;
  v_subtotal numeric;
  v_discount numeric;
  v_tax numeric;
begin
  select * into v_set from public.platform_billing_settings where id;
  select * into v_sub from public.school_subscriptions where school_id = p_school_id;
  if v_sub.id is null then raise exception 'No subscription exists for this school.'; end if;
  if v_sub.plan_id is not null then
    select * into v_plan from public.subscription_plans where id = v_sub.plan_id;
  end if;
  if v_sub.plan_id is null and v_sub.price_override_kes is null then
    raise exception 'School has no plan assigned — activate a subscription first.';
  end if;

  v_unit := coalesce(v_sub.price_override_kes, v_plan.price_per_student_kes);
  select count(*) into v_count from public.students
    where school_id = p_school_id and status = any (v_set.billable_student_statuses);
  v_subtotal := round(v_unit * v_count, 2);
  v_discount := round(v_subtotal * v_sub.recurring_discount_percent / 100, 2);
  v_tax := case when v_set.tax_enabled then round((v_subtotal - v_discount) * v_set.tax_rate_percent / 100, 2) else 0 end;

  return jsonb_build_object(
    'plan_id', v_sub.plan_id, 'plan_name', v_plan.name, 'unit_price_kes', v_unit, 'students', v_count,
    'subtotal_kes', v_subtotal, 'discount_kes', v_discount,
    'tax_label', case when v_set.tax_enabled then v_set.tax_label end,
    'tax_rate_percent', case when v_set.tax_enabled then v_set.tax_rate_percent else 0 end,
    'tax_kes', v_tax, 'total_kes', v_subtotal - v_discount + v_tax,
    'billable_statuses', to_jsonb(v_set.billable_student_statuses),
    'billing_email', v_sub.billing_email);
end;
$$;

create or replace function public._platform_reactivate_if_clear(p_school_id uuid)
returns void
language plpgsql
security definer
set search_path to 'public'
as $$
begin
  -- Same recovery the original record_platform_payment performed, but only once the school has
  -- no other overdue invoice, and the school itself is only reactivated if its subscription is
  -- (now) active -- so paying an invoice cannot reopen a voluntarily cancelled school.
  if exists (select 1 from public.platform_invoices where school_id = p_school_id and status = 'overdue') then
    return;
  end if;
  update public.school_subscriptions set status = 'active', updated_at = now()
    where school_id = p_school_id and status in ('past_due', 'suspended');
  update public.schools set status = 'active', updated_at = now()
    where id = p_school_id and status = 'suspended'
      and exists (select 1 from public.school_subscriptions s where s.school_id = p_school_id and s.status = 'active');
end;
$$;

create or replace function public._create_platform_invoice(
  p_school_id uuid, p_period_start date, p_period_end date, p_status text, p_source text,
  p_term_id uuid, p_label text, p_due_days integer, p_notes text, p_replaces uuid
) returns uuid
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_set public.platform_billing_settings%rowtype;
  v_school public.schools%rowtype;
  v_quote jsonb;
  v_date date := (now() at time zone 'Africa/Nairobi')::date;
  v_days integer;
  v_year integer := extract(year from (now() at time zone 'Africa/Nairobi'))::integer;
  v_seq integer;
  v_number text;
  v_label text;
  v_id uuid;
  v_sub_id uuid;
  v_term public.terms%rowtype;
begin
  if p_status not in ('draft', 'issued') then raise exception 'Invalid initial invoice status.'; end if;
  if p_period_end < p_period_start then raise exception 'Billing period end cannot be before its start.'; end if;

  perform pg_advisory_xact_lock(hashtextextended('platform_invoice:' || p_school_id::text, 0));

  select * into v_school from public.schools where id = p_school_id;
  if v_school.id is null then raise exception 'School not found.'; end if;
  select id into v_sub_id from public.school_subscriptions where school_id = p_school_id;
  v_quote := public._platform_invoice_quote(p_school_id);
  select * into v_set from public.platform_billing_settings where id;
  v_days := coalesce(p_due_days, v_set.payment_terms_days);

  if p_term_id is not null then select * into v_term from public.terms where id = p_term_id; end if;
  v_label := coalesce(nullif(btrim(p_label), ''),
    case when v_term.id is not null
         then 'Term ' || v_term.term_number || ' ' || extract(year from v_term.end_date)::int
         else to_char(p_period_start, 'FMDD Mon YYYY') || ' – ' || to_char(p_period_end, 'FMDD Mon YYYY') end);

  insert into public.platform_invoice_counters as c (year, last_value) values (v_year, 1)
    on conflict (year) do update set last_value = c.last_value + 1
    returning last_value into v_seq;
  v_number := v_set.invoice_prefix || '-' || v_year || '-' || lpad(v_seq::text, 4, '0');

  perform public._platform_invoice_write_on();
  insert into public.platform_invoices (
    school_id, subscription_id, period_start, period_end, student_count, amount_kes, status, issued_at, due_at,
    invoice_number, invoice_date, billing_period_label, term_id, plan_id, plan_name, unit_price_kes, subtotal_kes,
    discount_kes, tax_label, tax_rate_percent, tax_kes, source, replaces_invoice_id, billable_statuses,
    bill_to, payment_instructions, notes, pdf_version, pdf_generated_at, created_by)
  values (
    p_school_id, v_sub_id, p_period_start, p_period_end, (v_quote->>'students')::int, (v_quote->>'total_kes')::numeric,
    p_status, case when p_status = 'issued' then now() end, public._platform_invoice_due_at(v_date, v_days),
    v_number, v_date, v_label, p_term_id, nullif(v_quote->>'plan_id', '')::uuid, v_quote->>'plan_name',
    (v_quote->>'unit_price_kes')::numeric, (v_quote->>'subtotal_kes')::numeric,
    (v_quote->>'discount_kes')::numeric, v_quote->>'tax_label', (v_quote->>'tax_rate_percent')::numeric,
    (v_quote->>'tax_kes')::numeric, p_source, p_replaces,
    array(select jsonb_array_elements_text(v_quote->'billable_statuses')),
    jsonb_build_object('school_id', v_school.id, 'name', v_school.name, 'address', v_school.address, 'phone', v_school.phone,
                       'email', coalesce(v_quote->>'billing_email', v_school.email), 'kra_pin', v_school.kra_pin),
    v_set.payment_instructions || jsonb_build_object('footer_note', v_set.invoice_footer_note),
    nullif(btrim(p_notes), ''),
    case when p_status = 'issued' then 1 else 0 end, case when p_status = 'issued' then now() end, auth.uid())
  returning id into v_id;

  perform public._platform_invoice_event(v_id, 'created',
    jsonb_build_object('source', p_source, 'status', p_status, 'students', (v_quote->>'students')::int,
                       'unit_price_kes', (v_quote->>'unit_price_kes')::numeric, 'total_kes', (v_quote->>'total_kes')::numeric,
                       'period_start', p_period_start, 'period_end', p_period_end, 'replaces', p_replaces));
  if p_status = 'issued' then
    perform public._platform_invoice_event(v_id, 'issued', jsonb_build_object('due_at', public._platform_invoice_due_at(v_date, v_days)));
    perform public._platform_invoice_event(v_id, 'generated', jsonb_build_object('pdf_version', 1));
  end if;
  return v_id;
end;
$$;

-- ============================================================
-- 8. Client-callable functions (each authorizes itself)
-- ============================================================
-- Authorization everywhere: platform staff (auth_is_super_admin) or service_role.

-- Kept for the existing admin UI: creates and ISSUES immediately (original behaviour).
create or replace function public.generate_platform_invoice(
  p_school_id uuid, p_period_start date, p_period_end date, p_due_days integer default 14
) returns uuid
language plpgsql
security definer
set search_path to 'public'
as $$
begin
  if not (auth_is_super_admin() or auth.role() = 'service_role') then
    raise exception 'Not authorized to generate a platform invoice.';
  end if;
  return public._create_platform_invoice(p_school_id, p_period_start, p_period_end, 'issued', 'manual', null, null, p_due_days, null, null);
end;
$$;

create or replace function public.create_platform_invoice(
  p_school_id uuid, p_period_start date, p_period_end date,
  p_as_draft boolean default true, p_label text default null, p_due_days integer default null, p_notes text default null
) returns uuid
language plpgsql
security definer
set search_path to 'public'
as $$
begin
  if not (auth_is_super_admin() or auth.role() = 'service_role') then
    raise exception 'Not authorized to create a platform invoice.';
  end if;
  return public._create_platform_invoice(p_school_id, p_period_start, p_period_end,
    case when p_as_draft then 'draft' else 'issued' end, 'manual', null, p_label, p_due_days, p_notes, null);
end;
$$;

create or replace function public.issue_platform_invoice(p_invoice_id uuid, p_due_days integer default null)
returns void
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_inv public.platform_invoices%rowtype;
  v_set public.platform_billing_settings%rowtype;
  v_date date := (now() at time zone 'Africa/Nairobi')::date;
  v_due timestamptz;
begin
  if not (auth_is_super_admin() or auth.role() = 'service_role') then raise exception 'Not authorized to issue an invoice.'; end if;
  select * into v_inv from public.platform_invoices where id = p_invoice_id for update;
  if v_inv.id is null then raise exception 'Invoice not found.'; end if;
  if v_inv.status <> 'draft' then raise exception 'Only a draft invoice can be issued (this one is %).', v_inv.status; end if;
  select * into v_set from public.platform_billing_settings where id;
  v_due := public._platform_invoice_due_at(v_date, coalesce(p_due_days, v_set.payment_terms_days));

  perform public._platform_invoice_write_on();
  update public.platform_invoices set
    status = 'issued', issued_at = now(), invoice_date = v_date, due_at = v_due,
    payment_instructions = v_set.payment_instructions || jsonb_build_object('footer_note', v_set.invoice_footer_note),
    pdf_version = pdf_version + 1, pdf_generated_at = now()
  where id = p_invoice_id;
  perform public._platform_invoice_event(p_invoice_id, 'issued', jsonb_build_object('due_at', v_due));
  perform public._platform_invoice_event(p_invoice_id, 'generated', jsonb_build_object('pdf_version', v_inv.pdf_version + 1));
end;
$$;

create or replace function public.recalculate_platform_invoice(p_invoice_id uuid)
returns void
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_inv public.platform_invoices%rowtype;
  v_q jsonb;
  v_sc public.schools%rowtype;
begin
  if not (auth_is_super_admin() or auth.role() = 'service_role') then raise exception 'Not authorized to recalculate an invoice.'; end if;
  select * into v_inv from public.platform_invoices where id = p_invoice_id for update;
  if v_inv.id is null then raise exception 'Invoice not found.'; end if;
  if v_inv.status <> 'draft' then raise exception 'Only a draft invoice can be recalculated. Use Reissue for an issued invoice.'; end if;
  v_q := public._platform_invoice_quote(v_inv.school_id);
  select * into v_sc from public.schools where id = v_inv.school_id;

  perform public._platform_invoice_write_on();
  update public.platform_invoices set
    student_count = (v_q->>'students')::int, plan_id = nullif(v_q->>'plan_id', '')::uuid, plan_name = v_q->>'plan_name',
    unit_price_kes = (v_q->>'unit_price_kes')::numeric, subtotal_kes = (v_q->>'subtotal_kes')::numeric,
    discount_kes = (v_q->>'discount_kes')::numeric, tax_label = v_q->>'tax_label',
    tax_rate_percent = (v_q->>'tax_rate_percent')::numeric, tax_kes = (v_q->>'tax_kes')::numeric,
    amount_kes = (v_q->>'total_kes')::numeric,
    billable_statuses = array(select jsonb_array_elements_text(v_q->'billable_statuses')),
    bill_to = jsonb_build_object('school_id', v_sc.id, 'name', v_sc.name, 'address', v_sc.address, 'phone', v_sc.phone,
                                 'email', coalesce(v_q->>'billing_email', v_sc.email), 'kra_pin', v_sc.kra_pin)
  where id = p_invoice_id;
  perform public._platform_invoice_event(p_invoice_id, 'recalculated',
    jsonb_build_object('students', (v_q->>'students')::int, 'total_kes', (v_q->>'total_kes')::numeric));
end;
$$;

create or replace function public.mark_platform_invoice_sent(p_invoice_id uuid, p_sent_to text default null)
returns void
language plpgsql
security definer
set search_path to 'public'
as $$
declare v_inv public.platform_invoices%rowtype;
begin
  if not (auth_is_super_admin() or auth.role() = 'service_role') then raise exception 'Not authorized to mark an invoice as sent.'; end if;
  select * into v_inv from public.platform_invoices where id = p_invoice_id for update;
  if v_inv.id is null then raise exception 'Invoice not found.'; end if;
  if v_inv.status in ('draft', 'cancelled') then raise exception 'A % invoice cannot be sent.', v_inv.status; end if;

  perform public._platform_invoice_write_on();
  update public.platform_invoices set
    sent_at = now(), sent_to = coalesce(nullif(btrim(p_sent_to), ''), sent_to),
    status = case when v_inv.status = 'issued' then 'sent' else v_inv.status end
  where id = p_invoice_id;
  perform public._platform_invoice_event(p_invoice_id, 'sent', jsonb_build_object('to', p_sent_to));
end;
$$;

create or replace function public.log_platform_invoice_event(p_invoice_id uuid, p_event_type text, p_metadata jsonb default '{}'::jsonb)
returns void
language plpgsql
security definer
set search_path to 'public'
as $$
begin
  if not (auth_is_super_admin() or auth.role() = 'service_role') then raise exception 'Not authorized.'; end if;
  if p_event_type not in ('send_failed', 'reminder_sent') then raise exception 'This event type cannot be logged directly.'; end if;
  perform public._platform_invoice_event(p_invoice_id, p_event_type, p_metadata);
end;
$$;

create or replace function public.record_platform_invoice_download(p_invoice_id uuid)
returns void
language plpgsql
security definer
set search_path to 'public'
as $$
declare v_inv public.platform_invoices%rowtype;
begin
  select * into v_inv from public.platform_invoices where id = p_invoice_id;
  if v_inv.id is null then return; end if;
  if not (auth_is_super_admin()
          or (v_inv.school_id = auth_school_id() and v_inv.status <> 'draft' and auth_has_permission('billing.read'))) then
    raise exception 'Not authorized.';
  end if;
  perform public._platform_invoice_event(p_invoice_id, 'downloaded', '{}'::jsonb);
end;
$$;

create or replace function public.record_platform_invoice_payment(
  p_invoice_id uuid, p_amount numeric, p_paid_on date default null, p_method text default 'other',
  p_reference text default null, p_notes text default null
) returns uuid
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_inv public.platform_invoices%rowtype;
  v_pay uuid;
  v_paid numeric;
  v_status text;
begin
  if not (auth_is_super_admin() or auth.role() = 'service_role') then raise exception 'Not authorized to record a platform payment.'; end if;
  select * into v_inv from public.platform_invoices where id = p_invoice_id for update;
  if v_inv.id is null then raise exception 'Invoice not found.'; end if;
  if v_inv.status in ('draft', 'cancelled', 'paid') then raise exception 'A % invoice cannot take a payment.', v_inv.status; end if;
  if p_amount is null or p_amount <= 0 then raise exception 'Payment amount must be greater than zero.'; end if;
  if p_amount > v_inv.amount_kes - v_inv.amount_paid_kes then
    raise exception 'Payment (KES %) exceeds the outstanding balance (KES %).', p_amount, v_inv.amount_kes - v_inv.amount_paid_kes;
  end if;

  insert into public.platform_invoice_payments (invoice_id, school_id, amount_kes, paid_on, method, reference, notes, recorded_by, recorded_by_label)
  values (p_invoice_id, v_inv.school_id, p_amount, coalesce(p_paid_on, (now() at time zone 'Africa/Nairobi')::date),
          coalesce(p_method, 'other'), nullif(btrim(p_reference), ''), nullif(btrim(p_notes), ''), auth.uid(), coalesce(auth.email(), 'system'))
  returning id into v_pay;

  v_paid := v_inv.amount_paid_kes + p_amount;
  v_status := public._platform_invoice_status_for(v_inv.amount_kes, v_paid, v_inv.due_at, v_inv.sent_at);
  perform public._platform_invoice_write_on();
  update public.platform_invoices set
    amount_paid_kes = v_paid, status = v_status,
    paid_at = case when v_status = 'paid' then now() else paid_at end,
    payment_reference = coalesce(nullif(btrim(p_reference), ''), payment_reference)
  where id = p_invoice_id;

  perform public._platform_invoice_event(p_invoice_id, 'payment_recorded',
    jsonb_build_object('payment_id', v_pay, 'amount_kes', p_amount, 'method', p_method, 'reference', p_reference, 'balance_kes', v_inv.amount_kes - v_paid));
  if v_status = 'paid' then
    perform public._platform_invoice_event(p_invoice_id, 'paid', jsonb_build_object('amount_paid_kes', v_paid));
    perform public._platform_reactivate_if_clear(v_inv.school_id);
  end if;
  return v_pay;
end;
$$;

-- Original signature preserved: marks the whole outstanding balance as paid.
create or replace function public.record_platform_payment(p_invoice_id uuid, p_reference text default null)
returns void
language plpgsql
security definer
set search_path to 'public'
as $$
declare v_balance numeric;
begin
  if not (auth_is_super_admin() or auth.role() = 'service_role') then raise exception 'Not authorized to record a platform payment.'; end if;
  select amount_kes - amount_paid_kes into v_balance from public.platform_invoices where id = p_invoice_id;
  if v_balance is null then raise exception 'Invoice not found.'; end if;
  if v_balance <= 0 then raise exception 'This invoice has no outstanding balance.'; end if;
  perform public.record_platform_invoice_payment(p_invoice_id, v_balance, null, 'unspecified', p_reference, null);
end;
$$;

create or replace function public.void_platform_invoice_payment(p_payment_id uuid, p_reason text)
returns void
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_pay public.platform_invoice_payments%rowtype;
  v_inv public.platform_invoices%rowtype;
  v_paid numeric;
begin
  if not (auth_is_super_admin() or auth.role() = 'service_role') then raise exception 'Not authorized.'; end if;
  if p_reason is null or char_length(btrim(p_reason)) < 3 then raise exception 'A reason is required to void a payment.'; end if;
  select * into v_pay from public.platform_invoice_payments where id = p_payment_id for update;
  if v_pay.id is null then raise exception 'Payment not found.'; end if;
  if v_pay.voided_at is not null then raise exception 'This payment is already voided.'; end if;
  select * into v_inv from public.platform_invoices where id = v_pay.invoice_id for update;

  update public.platform_invoice_payments set voided_at = now(), voided_reason = btrim(p_reason) where id = p_payment_id;
  v_paid := v_inv.amount_paid_kes - v_pay.amount_kes;
  perform public._platform_invoice_write_on();
  update public.platform_invoices set
    amount_paid_kes = v_paid,
    status = case when v_inv.status = 'cancelled' then 'cancelled'
                  else public._platform_invoice_status_for(v_inv.amount_kes, v_paid, v_inv.due_at, v_inv.sent_at) end,
    paid_at = case when v_paid >= v_inv.amount_kes and v_paid > 0 then paid_at end
  where id = v_pay.invoice_id;
  perform public._platform_invoice_event(v_pay.invoice_id, 'payment_voided',
    jsonb_build_object('payment_id', p_payment_id, 'amount_kes', v_pay.amount_kes, 'reason', btrim(p_reason)));
end;
$$;

create or replace function public.cancel_platform_invoice(p_invoice_id uuid, p_reason text)
returns void
language plpgsql
security definer
set search_path to 'public'
as $$
declare v_inv public.platform_invoices%rowtype;
begin
  if not (auth_is_super_admin() or auth.role() = 'service_role') then raise exception 'Not authorized to cancel an invoice.'; end if;
  if p_reason is null or char_length(btrim(p_reason)) < 3 then raise exception 'A reason is required to cancel an invoice.'; end if;
  select * into v_inv from public.platform_invoices where id = p_invoice_id for update;
  if v_inv.id is null then raise exception 'Invoice not found.'; end if;
  if v_inv.status = 'cancelled' then raise exception 'This invoice is already cancelled.'; end if;
  if v_inv.amount_paid_kes > 0 then raise exception 'This invoice has payments recorded against it. Void them first, or leave it in place.'; end if;

  perform public._platform_invoice_write_on();
  update public.platform_invoices set status = 'cancelled', cancelled_at = now(), cancel_reason = btrim(p_reason) where id = p_invoice_id;
  perform public._platform_invoice_event(p_invoice_id, 'cancelled', jsonb_build_object('reason', btrim(p_reason), 'previous_status', v_inv.status));
end;
$$;

create or replace function public.adjust_platform_invoice(p_invoice_id uuid, p_discount_kes numeric, p_reason text)
returns void
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_inv public.platform_invoices%rowtype;
  v_set public.platform_billing_settings%rowtype;
  v_tax numeric;
  v_total numeric;
  v_status text;
begin
  if not (auth_is_super_admin() or auth.role() = 'service_role') then raise exception 'Not authorized to adjust an invoice.'; end if;
  if p_reason is null or char_length(btrim(p_reason)) < 3 then raise exception 'A reason is required for an adjustment.'; end if;
  select * into v_inv from public.platform_invoices where id = p_invoice_id for update;
  if v_inv.id is null then raise exception 'Invoice not found.'; end if;
  if v_inv.status in ('cancelled', 'paid') then raise exception 'A % invoice cannot be adjusted.', v_inv.status; end if;
  if p_discount_kes is null or p_discount_kes < 0 or p_discount_kes > v_inv.subtotal_kes then
    raise exception 'Discount must be between 0 and the invoice subtotal (KES %).', v_inv.subtotal_kes;
  end if;
  select * into v_set from public.platform_billing_settings where id;
  v_tax := round((v_inv.subtotal_kes - p_discount_kes) * v_inv.tax_rate_percent / 100, 2);
  v_total := v_inv.subtotal_kes - p_discount_kes + v_tax;
  if v_total < v_inv.amount_paid_kes then raise exception 'The adjusted total (KES %) would be below the amount already paid (KES %).', v_total, v_inv.amount_paid_kes; end if;
  v_status := case when v_inv.status = 'draft' then 'draft'
                   else public._platform_invoice_status_for(v_total, v_inv.amount_paid_kes, v_inv.due_at, v_inv.sent_at) end;

  perform public._platform_invoice_write_on();
  update public.platform_invoices set discount_kes = p_discount_kes, tax_kes = v_tax, amount_kes = v_total, status = v_status,
    paid_at = case when v_status = 'paid' then coalesce(paid_at, now()) else paid_at end
  where id = p_invoice_id;
  perform public._platform_invoice_event(p_invoice_id, 'adjusted',
    jsonb_build_object('reason', btrim(p_reason), 'discount_kes', p_discount_kes, 'previous_discount_kes', v_inv.discount_kes,
                       'previous_total_kes', v_inv.amount_kes, 'total_kes', v_total));
  if v_status = 'paid' and v_inv.status <> 'paid' then
    perform public._platform_invoice_event(p_invoice_id, 'paid', jsonb_build_object('via', 'adjustment'));
    perform public._platform_reactivate_if_clear(v_inv.school_id);
  end if;
end;
$$;

create or replace function public.set_platform_invoice_due_date(p_invoice_id uuid, p_due_on date, p_reason text)
returns void
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_inv public.platform_invoices%rowtype;
  v_due timestamptz;
begin
  if not (auth_is_super_admin() or auth.role() = 'service_role') then raise exception 'Not authorized to change a due date.'; end if;
  if p_reason is null or char_length(btrim(p_reason)) < 3 then raise exception 'A reason is required to change a due date.'; end if;
  select * into v_inv from public.platform_invoices where id = p_invoice_id for update;
  if v_inv.id is null then raise exception 'Invoice not found.'; end if;
  if v_inv.status in ('cancelled', 'paid') then raise exception 'A % invoice''s due date cannot be changed.', v_inv.status; end if;
  if p_due_on < v_inv.invoice_date then raise exception 'The due date cannot be before the invoice date.'; end if;
  v_due := public._platform_invoice_due_at(p_due_on, 0);

  perform public._platform_invoice_write_on();
  update public.platform_invoices set due_at = v_due,
    status = case when v_inv.status = 'draft' then 'draft'
                  else public._platform_invoice_status_for(amount_kes, amount_paid_kes, v_due, sent_at) end
  where id = p_invoice_id;
  perform public._platform_invoice_event(p_invoice_id, 'due_date_changed',
    jsonb_build_object('reason', btrim(p_reason), 'from', v_inv.due_at, 'to', v_due));
  -- Pushing a due date forward can clear an 'overdue' status; reactivation is left to a payment
  -- or an explicit admin action, deliberately.
end;
$$;

create or replace function public.set_platform_invoice_notes(p_invoice_id uuid, p_notes text)
returns void
language plpgsql
security definer
set search_path to 'public'
as $$
begin
  if not (auth_is_super_admin() or auth.role() = 'service_role') then raise exception 'Not authorized.'; end if;
  perform public._platform_invoice_write_on();
  update public.platform_invoices set notes = nullif(btrim(p_notes), '') where id = p_invoice_id and status <> 'cancelled';
  if not found then raise exception 'Invoice not found or cancelled.'; end if;
  perform public._platform_invoice_event(p_invoice_id, 'notes_updated', '{}'::jsonb);
end;
$$;

create or replace function public.regenerate_platform_invoice_pdf(p_invoice_id uuid)
returns integer
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_inv public.platform_invoices%rowtype;
  v_set public.platform_billing_settings%rowtype;
begin
  if not (auth_is_super_admin() or auth.role() = 'service_role') then raise exception 'Not authorized.'; end if;
  select * into v_inv from public.platform_invoices where id = p_invoice_id for update;
  if v_inv.id is null then raise exception 'Invoice not found.'; end if;
  select * into v_set from public.platform_billing_settings where id;

  perform public._platform_invoice_write_on();
  -- Unpaid invoices pick up the CURRENT payment instructions; paid/cancelled ones keep what they were issued with.
  update public.platform_invoices set
    pdf_version = pdf_version + 1, pdf_generated_at = now(),
    payment_instructions = case when status in ('issued', 'sent', 'overdue', 'partially_paid')
      then v_set.payment_instructions || jsonb_build_object('footer_note', v_set.invoice_footer_note) else payment_instructions end
  where id = p_invoice_id;
  perform public._platform_invoice_event(p_invoice_id, 'regenerated', jsonb_build_object('pdf_version', v_inv.pdf_version + 1));
  return v_inv.pdf_version + 1;
end;
$$;

-- Cancels the original and creates a fresh, recalculated invoice (new number) for the same period.
create or replace function public.reissue_platform_invoice(p_invoice_id uuid, p_reason text)
returns uuid
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_inv public.platform_invoices%rowtype;
  v_new uuid;
begin
  if not (auth_is_super_admin() or auth.role() = 'service_role') then raise exception 'Not authorized to reissue an invoice.'; end if;
  if p_reason is null or char_length(btrim(p_reason)) < 3 then raise exception 'A reason is required to reissue an invoice.'; end if;
  select * into v_inv from public.platform_invoices where id = p_invoice_id for update;
  if v_inv.id is null then raise exception 'Invoice not found.'; end if;
  if v_inv.status in ('cancelled', 'paid', 'draft') then raise exception 'A % invoice cannot be reissued.', v_inv.status; end if;
  if v_inv.amount_paid_kes > 0 then raise exception 'This invoice has payments against it. Void them before reissuing.'; end if;

  perform public._platform_invoice_write_on();
  update public.platform_invoices set status = 'cancelled', cancelled_at = now(), cancel_reason = 'Reissued: ' || btrim(p_reason) where id = p_invoice_id;
  v_new := public._create_platform_invoice(v_inv.school_id, v_inv.period_start, v_inv.period_end, 'issued', v_inv.source,
                                           v_inv.term_id, v_inv.billing_period_label, null, v_inv.notes, p_invoice_id);
  perform public._platform_invoice_event(p_invoice_id, 'reissued', jsonb_build_object('reason', btrim(p_reason), 'replaced_by', v_new));
  perform public._platform_invoice_event(p_invoice_id, 'cancelled', jsonb_build_object('reason', 'Reissued', 'previous_status', v_inv.status));
  return v_new;
end;
$$;

-- ============================================================
-- 9. Maintenance: overdue sweep (replaces the original, same name/signature)
-- ============================================================
create or replace function public.mark_invoices_overdue()
returns integer
language plpgsql
security definer
set search_path to 'public'
as $$
declare v_count integer;
begin
  if not (auth_is_super_admin() or auth.role() = 'service_role') then
    raise exception 'Not authorized to mark invoices overdue.';
  end if;
  perform public._platform_invoice_write_on();

  -- Drafts and zero-balance invoices are never swept. Partially paid invoices past due are.
  with overdue as (
    update public.platform_invoices
      set status = 'overdue'
      where status in ('issued', 'sent', 'partially_paid')
        and due_at < now()
        and amount_kes - amount_paid_kes > 0
      returning id, school_id, subscription_id, due_at
  ), ev as (
    insert into public.platform_invoice_events (invoice_id, school_id, event_type, actor_label, metadata)
    select id, school_id, 'overdue', 'system', jsonb_build_object('due_at', due_at) from overdue
  ), subs as (
    update public.school_subscriptions set status = 'past_due', updated_at = now()
      where id in (select subscription_id from overdue) and status = 'active'
  )
  select count(*) into v_count from overdue;
  return v_count;
end;
$$;

-- ============================================================
-- 10. Settings + per-school billing terms
-- ============================================================
create or replace function public.set_platform_billing_settings(p_settings jsonb)
returns void
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_pi jsonb;
  v_key text;
  v_clean jsonb := '{}'::jsonb;
  v_allowed text[] := array['mpesa_paybill', 'mpesa_paybill_account', 'mpesa_till', 'bank_name', 'bank_branch',
                            'account_name', 'account_number', 'swift_code', 'other_instructions', 'reference_note'];
  v_val text;
  v_max integer;
begin
  if not auth_is_super_admin() then raise exception 'Not authorized to change billing settings.'; end if;
  if p_settings is null or jsonb_typeof(p_settings) <> 'object' then raise exception 'Settings must be a JSON object.'; end if;

  if p_settings ? 'payment_instructions' then
    v_pi := p_settings->'payment_instructions';
    if jsonb_typeof(v_pi) <> 'object' then raise exception 'payment_instructions must be an object.'; end if;
    for v_key in select jsonb_object_keys(v_pi) loop
      if not (v_key = any (v_allowed)) then raise exception 'Unknown payment instruction field: %', v_key; end if;
      v_val := btrim(coalesce(v_pi->>v_key, ''));
      v_max := case when v_key = 'other_instructions' then 1000 else 200 end;
      if char_length(v_val) > v_max then
        raise exception 'Payment instruction field % is too long.', v_key;
      end if;
      if v_val <> '' then v_clean := v_clean || jsonb_build_object(v_key, v_val); end if;
    end loop;
  end if;

  update public.platform_billing_settings s set
    invoice_prefix = coalesce(p_settings->>'invoice_prefix', s.invoice_prefix),
    payment_terms_days = coalesce((p_settings->>'payment_terms_days')::int, s.payment_terms_days),
    auto_generate_enabled = coalesce((p_settings->>'auto_generate_enabled')::boolean, s.auto_generate_enabled),
    auto_effective_from = case when p_settings ? 'auto_effective_from' then nullif(p_settings->>'auto_effective_from', '')::date else s.auto_effective_from end,
    auto_lookback_days = coalesce((p_settings->>'auto_lookback_days')::int, s.auto_lookback_days),
    auto_issue = coalesce((p_settings->>'auto_issue')::boolean, s.auto_issue),
    auto_send = coalesce((p_settings->>'auto_send')::boolean, s.auto_send),
    billable_student_statuses = case when p_settings ? 'billable_student_statuses'
      then array(select jsonb_array_elements_text(p_settings->'billable_student_statuses')) else s.billable_student_statuses end,
    tax_enabled = coalesce((p_settings->>'tax_enabled')::boolean, s.tax_enabled),
    tax_label = coalesce(p_settings->>'tax_label', s.tax_label),
    tax_rate_percent = coalesce((p_settings->>'tax_rate_percent')::numeric, s.tax_rate_percent),
    invoice_footer_note = coalesce(p_settings->>'invoice_footer_note', s.invoice_footer_note),
    payment_instructions = case when p_settings ? 'payment_instructions' then v_clean else s.payment_instructions end,
    updated_at = now(), updated_by = auth.uid()
  where s.id;
end;
$$;

create or replace function public.set_school_billing_terms(
  p_school_id uuid, p_price_override_kes numeric default null, p_discount_percent numeric default 0,
  p_discount_note text default null, p_billing_email text default null
) returns void
language plpgsql
security definer
set search_path to 'public'
as $$
begin
  if not auth_is_super_admin() then raise exception 'Not authorized to change a school''s billing terms.'; end if;
  update public.school_subscriptions set
    price_override_kes = p_price_override_kes,
    recurring_discount_percent = coalesce(p_discount_percent, 0),
    discount_note = nullif(btrim(p_discount_note), ''),
    billing_email = nullif(btrim(p_billing_email), ''),
    updated_at = now()
  where school_id = p_school_id;
  if not found then raise exception 'No subscription exists for this school.'; end if;
end;
$$;

-- ============================================================
-- 11. Automated billing cycle: planner (read-only) + runner
-- ============================================================
create or replace function public.plan_platform_billing_cycle(p_as_of date default null)
returns table (
  school_id uuid, school_name text, term_id uuid, period_start date, period_end date, label text,
  students integer, unit_price_kes numeric, total_kes numeric, decision text, reason text
)
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_set public.platform_billing_settings%rowtype;
  v_asof date := coalesce(p_as_of, (now() at time zone 'Africa/Nairobi')::date);
  r record;
  v_q jsonb;
  v_reason text;
  v_seen jsonb := '{}'::jsonb;
  v_last_end date;
begin
  if not (auth_is_super_admin() or auth.role() = 'service_role') then raise exception 'Not authorized.'; end if;
  select * into v_set from public.platform_billing_settings where id;

  -- Candidates: paying (active subscription) schools, terms that have ENDED (by end_date, never by
  -- the user-editable term.status), within the look-back window and on/after the effective date.
  for r in
    select sc.id as sid, sc.name as sname, t.id as tid, t.start_date, t.end_date, t.term_number,
           sub.current_period_start, sub.plan_id, sub.price_override_kes, pl.billing_period
    from public.schools sc
    join public.school_subscriptions sub on sub.school_id = sc.id
    left join public.subscription_plans pl on pl.id = sub.plan_id
    join public.terms t on t.school_id = sc.id
    where sc.status = 'active' and sub.status = 'active'
      and t.end_date <= v_asof
      and t.end_date >= v_asof - v_set.auto_lookback_days
      and (v_set.auto_effective_from is null or t.end_date >= v_set.auto_effective_from)
    order by sc.name, t.start_date, t.id
  loop
    school_id := r.sid; school_name := r.sname; term_id := r.tid; period_start := r.start_date; period_end := r.end_date;
    label := 'Term ' || r.term_number || ' ' || extract(year from r.end_date)::int;
    students := null; unit_price_kes := null; total_kes := null; decision := 'skip'; reason := null;

    if exists (select 1 from public.platform_invoices i where i.school_id = r.sid and i.term_id = r.tid and i.status <> 'cancelled') then
      reason := 'already_invoiced';
    elsif r.plan_id is null and r.price_override_kes is null then
      reason := 'no_plan_assigned';
    elsif r.billing_period is not null and r.billing_period <> 'termly' then
      reason := 'plan_not_termly (automation only supports termly billing)';
    elsif r.current_period_start is not null and r.current_period_start > r.end_date then
      reason := 'subscription_started_after_term_ended';
    elsif exists (select 1 from public.platform_invoices i where i.school_id = r.sid and i.status <> 'cancelled'
                  and i.period_start < r.end_date and i.period_end > r.start_date) then
      reason := 'overlaps_existing_invoice';
    elsif (v_seen ->> r.sid::text) is not null and (v_seen ->> r.sid::text)::date > r.start_date then
      reason := 'overlaps_earlier_term_in_this_run';
    else
      v_q := public._platform_invoice_quote(r.sid);
      students := (v_q->>'students')::int; unit_price_kes := (v_q->>'unit_price_kes')::numeric; total_kes := (v_q->>'total_kes')::numeric;
      if students = 0 then
        reason := 'no_billable_students';
      else
        decision := 'create';
        v_seen := v_seen || jsonb_build_object(r.sid::text, r.end_date::text);
      end if;
    end if;
    return next;
  end loop;
end;
$$;

create or replace function public.run_platform_billing_cycle(
  p_dry_run boolean default true, p_trigger text default 'manual', p_as_of date default null
) returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_set public.platform_billing_settings%rowtype;
  v_status text;
  r record;
  v_id uuid;
  v_num text;
  v_created jsonb := '[]'::jsonb;
  v_would jsonb := '[]'::jsonb;
  v_skipped jsonb := '[]'::jsonb;
  v_errors jsonb := '[]'::jsonb;
begin
  if not (auth_is_super_admin() or auth.role() = 'service_role') then raise exception 'Not authorized to run the billing cycle.'; end if;
  select * into v_set from public.platform_billing_settings where id;

  -- The scheduled run does nothing unless an administrator has switched automation on.
  if p_trigger = 'cron' and not v_set.auto_generate_enabled then
    return jsonb_build_object('ran', false, 'reason', 'auto_generate_disabled');
  end if;

  v_status := case when v_set.auto_issue then 'issued' else 'draft' end;

  for r in select * from public.plan_platform_billing_cycle(p_as_of) loop
    if r.decision = 'create' then
      if p_dry_run then
        v_would := v_would || jsonb_build_array(jsonb_build_object('school_id', r.school_id, 'school_name', r.school_name,
          'label', r.label, 'period_start', r.period_start, 'period_end', r.period_end, 'students', r.students,
          'unit_price_kes', r.unit_price_kes, 'total_kes', r.total_kes, 'status', v_status));
      else
        begin
          v_id := public._create_platform_invoice(r.school_id, r.period_start, r.period_end, v_status, 'auto', r.term_id, r.label, null, null, null);
          select invoice_number into v_num from public.platform_invoices where id = v_id;
          v_created := v_created || jsonb_build_array(jsonb_build_object('invoice_id', v_id, 'invoice_number', v_num,
            'school_id', r.school_id, 'school_name', r.school_name, 'total_kes', r.total_kes, 'status', v_status));
        exception when others then
          v_errors := v_errors || jsonb_build_array(jsonb_build_object('school_id', r.school_id, 'school_name', r.school_name, 'label', r.label, 'error', sqlerrm));
        end;
      end if;
    elsif r.reason <> 'already_invoiced' then
      v_skipped := v_skipped || jsonb_build_array(jsonb_build_object('school_id', r.school_id, 'school_name', r.school_name, 'label', r.label, 'reason', r.reason));
    end if;
  end loop;

  return jsonb_build_object('ran', true, 'dry_run', p_dry_run, 'trigger', p_trigger, 'status_on_create', v_status,
    'created', v_created, 'would_create', v_would, 'skipped', v_skipped, 'errors', v_errors);
end;
$$;

-- ============================================================
-- 12. Privileges for functions
-- ============================================================
-- Internal helpers: no client access at all.
revoke all on function public._platform_invoice_event(uuid, text, jsonb) from public, anon, authenticated;
revoke all on function public._platform_invoice_write_on() from public, anon, authenticated;
revoke all on function public._platform_invoice_status_for(numeric, numeric, timestamptz, timestamptz) from public, anon, authenticated;
revoke all on function public._platform_invoice_due_at(date, integer) from public, anon, authenticated;
revoke all on function public._platform_invoice_quote(uuid) from public, anon, authenticated;
revoke all on function public._platform_reactivate_if_clear(uuid) from public, anon, authenticated;
revoke all on function public._create_platform_invoice(uuid, date, date, text, text, uuid, text, integer, text, uuid) from public, anon, authenticated;

-- Client-callable (each checks authorization itself): authenticated + service_role only.
revoke all on function public.generate_platform_invoice(uuid, date, date, integer) from public, anon;
revoke all on function public.create_platform_invoice(uuid, date, date, boolean, text, integer, text) from public, anon;
revoke all on function public.issue_platform_invoice(uuid, integer) from public, anon;
revoke all on function public.recalculate_platform_invoice(uuid) from public, anon;
revoke all on function public.mark_platform_invoice_sent(uuid, text) from public, anon;
revoke all on function public.log_platform_invoice_event(uuid, text, jsonb) from public, anon;
revoke all on function public.record_platform_invoice_download(uuid) from public, anon;
revoke all on function public.record_platform_invoice_payment(uuid, numeric, date, text, text, text) from public, anon;
revoke all on function public.record_platform_payment(uuid, text) from public, anon;
revoke all on function public.void_platform_invoice_payment(uuid, text) from public, anon;
revoke all on function public.cancel_platform_invoice(uuid, text) from public, anon;
revoke all on function public.adjust_platform_invoice(uuid, numeric, text) from public, anon;
revoke all on function public.set_platform_invoice_due_date(uuid, date, text) from public, anon;
revoke all on function public.set_platform_invoice_notes(uuid, text) from public, anon;
revoke all on function public.regenerate_platform_invoice_pdf(uuid) from public, anon;
revoke all on function public.reissue_platform_invoice(uuid, text) from public, anon;
revoke all on function public.mark_invoices_overdue() from public, anon;
revoke all on function public.set_platform_billing_settings(jsonb) from public, anon;
revoke all on function public.set_school_billing_terms(uuid, numeric, numeric, text, text) from public, anon;
revoke all on function public.plan_platform_billing_cycle(date) from public, anon;
revoke all on function public.run_platform_billing_cycle(boolean, text, date) from public, anon;

grant execute on function public.generate_platform_invoice(uuid, date, date, integer) to authenticated, service_role;
grant execute on function public.create_platform_invoice(uuid, date, date, boolean, text, integer, text) to authenticated, service_role;
grant execute on function public.issue_platform_invoice(uuid, integer) to authenticated, service_role;
grant execute on function public.recalculate_platform_invoice(uuid) to authenticated, service_role;
grant execute on function public.mark_platform_invoice_sent(uuid, text) to authenticated, service_role;
grant execute on function public.log_platform_invoice_event(uuid, text, jsonb) to authenticated, service_role;
grant execute on function public.record_platform_invoice_download(uuid) to authenticated;
grant execute on function public.record_platform_invoice_payment(uuid, numeric, date, text, text, text) to authenticated, service_role;
grant execute on function public.record_platform_payment(uuid, text) to authenticated, service_role;
grant execute on function public.void_platform_invoice_payment(uuid, text) to authenticated, service_role;
grant execute on function public.cancel_platform_invoice(uuid, text) to authenticated, service_role;
grant execute on function public.adjust_platform_invoice(uuid, numeric, text) to authenticated, service_role;
grant execute on function public.set_platform_invoice_due_date(uuid, date, text) to authenticated, service_role;
grant execute on function public.set_platform_invoice_notes(uuid, text) to authenticated, service_role;
grant execute on function public.regenerate_platform_invoice_pdf(uuid) to authenticated, service_role;
grant execute on function public.reissue_platform_invoice(uuid, text) to authenticated, service_role;
grant execute on function public.mark_invoices_overdue() to authenticated, service_role;
grant execute on function public.set_platform_billing_settings(jsonb) to authenticated;
grant execute on function public.set_school_billing_terms(uuid, numeric, numeric, text, text) to authenticated;
grant execute on function public.plan_platform_billing_cycle(date) to authenticated, service_role;
grant execute on function public.run_platform_billing_cycle(boolean, text, date) to authenticated, service_role;
