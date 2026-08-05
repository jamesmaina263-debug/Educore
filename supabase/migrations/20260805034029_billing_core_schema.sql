-- Platform billing/subscription module (Gap Analysis Tier 1 #1): how Trimora
-- bills each school. schools.status already existed (trial/active/suspended)
-- but nothing drove it — this closes that loop. Widen the status check to
-- add 'cancelled' (voluntary close, distinct from 'suspended' = payment issue).
alter table schools drop constraint schools_status_check;
alter table schools add constraint schools_status_check
  check (status = any (array['trial','active','suspended','cancelled']));

create table subscription_plans (
  id uuid primary key default gen_random_uuid(),
  code text not null unique,
  name text not null,
  description text,
  price_per_student_kes numeric not null check (price_per_student_kes >= 0),
  billing_period text not null default 'termly' check (billing_period in ('termly','monthly','annual')),
  max_students integer,
  features jsonb not null default '{}',
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
comment on table subscription_plans is 'Platform-wide pricing plans a school subscribes to. Not school-scoped — one shared catalogue, same convention as payroll_statutory_rates.';

create table school_subscriptions (
  id uuid primary key default gen_random_uuid(),
  school_id uuid not null references schools(id) unique,
  plan_id uuid references subscription_plans(id),
  status text not null default 'trialing' check (status in ('trialing','active','past_due','suspended','cancelled')),
  trial_ends_at timestamptz,
  current_period_start date,
  current_period_end date,
  cancellation_reason text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
comment on table school_subscriptions is 'One row per school: its current relationship with the platform. Historical changes are visible via platform_invoices and audit_log, not multiple rows here — same "current state, not a log" pattern as schools.status itself.';

create table platform_invoices (
  id uuid primary key default gen_random_uuid(),
  school_id uuid not null references schools(id),
  subscription_id uuid not null references school_subscriptions(id),
  period_start date not null,
  period_end date not null,
  student_count integer not null check (student_count >= 0),
  amount_kes numeric not null check (amount_kes >= 0),
  status text not null default 'issued' check (status in ('issued','paid','overdue','cancelled')),
  issued_at timestamptz not null default now(),
  due_at timestamptz not null,
  paid_at timestamptz,
  payment_reference text,
  created_at timestamptz not null default now()
);
comment on table platform_invoices is 'What Trimora billed a school for a period, and whether it was paid. All payments today are manual (super_admin records a reference after a bank/M-Pesa transfer) — same "manual bursar entry" pattern as school-level Finance in Phase 2, no platform payment gateway automation exists yet.';

create index idx_platform_invoices_school on platform_invoices(school_id);
create index idx_platform_invoices_status on platform_invoices(status);

alter table subscription_plans enable row level security;
alter table school_subscriptions enable row level security;
alter table platform_invoices enable row level security;

-- Plans: any signed-in user can read (needed for an in-app "your plan" or
-- upgrade view later); anon reads happen server-side via the admin client
-- during signup instead of an RLS policy, so no anon policy here.
create policy subscription_plans_select on subscription_plans
  for select to authenticated using (true);
create policy subscription_plans_manage on subscription_plans
  for all to authenticated
  using (auth_is_super_admin())
  with check (auth_is_super_admin());

-- Billing visibility is owner-only within a school — even stricter than
-- Finance's principal-read-only-day-to-day pattern from Phase 2, because
-- this is the school's own contract with the platform, an ownership-level
-- concern, not a day-to-day finance figure. Platform staff (super_admin)
-- see every school's row for billing operations.
create policy school_subscriptions_select on school_subscriptions
  for select to authenticated
  using (auth_is_super_admin() or (school_id = auth_school_id() and auth_has_permission('billing.read')));
create policy school_subscriptions_manage on school_subscriptions
  for all to authenticated
  using (auth_is_super_admin())
  with check (auth_is_super_admin());

create policy platform_invoices_select on platform_invoices
  for select to authenticated
  using (auth_is_super_admin() or (school_id = auth_school_id() and auth_has_permission('billing.read')));
create policy platform_invoices_manage on platform_invoices
  for all to authenticated
  using (auth_is_super_admin())
  with check (auth_is_super_admin());

-- New permission: billing.read, school_owner only (deliberately narrower
-- than Finance's owner+principal — documented judgment call, matches the
-- comment above).
insert into role_permissions (role_id, school_id, permission_key, allowed)
select id, null, 'billing.read', true from roles where name = 'school_owner';
