-- Phase 8, Item 1: Student Financial Account
-- One per enrolled student, carrying a unique Student Payment Reference (e.g. EDU00452,
-- never the student's name) — shown on the Student Finance profile, Parent Portal, invoices,
-- fee statements, receipts, and (later) the Admissions financial summary. This is an internal
-- financial identity/ledger anchor, not a bank account or wallet (brief §4.7).

create sequence if not exists student_payment_reference_seq;

create table student_financial_accounts (
  id uuid primary key default gen_random_uuid(),
  school_id uuid not null references schools(id) on delete cascade,
  student_id uuid not null unique references students(id) on delete cascade,
  payment_reference text not null,
  created_at timestamptz not null default now(),
  unique (school_id, payment_reference)
);
comment on table student_financial_accounts is 'The Student Financial Account (brief §4.7): one per student, never a duplicate student entity. payment_reference is the identifier a parent quotes when paying — e.g. EDU00452 — distinct from admission_number, which is an academic/administrative identifier.';

create index student_financial_accounts_school_id_idx on student_financial_accounts (school_id);

alter table student_financial_accounts enable row level security;

-- Same visibility tier as the rest of Finance: staff with finance.read, the student's own
-- guardian, or the student themself (parent/self need their own reference to pay by).
create policy student_financial_accounts_select on student_financial_accounts for select
  using (
    (school_id = auth_school_id() and auth_has_permission('finance.read'))
    or auth_user_id_is_guardian_of(student_financial_accounts.student_id)
    or exists (
      select 1 from students st join school_users su on su.id = st.school_user_id
      where st.id = student_financial_accounts.student_id and su.auth_user_id = (select auth.uid())
    )
  );
-- No direct write policy — only via get_or_create_student_financial_account() below, so a
-- reference can never be hand-typed or duplicated by a client insert.

-- Idempotent: returns the existing account if one exists, otherwise creates it. This is the
-- single entry point every other Finance operation (invoicing, payments, the future Admissions
-- Step 9 hook) uses to obtain a student's account — never a raw insert.
create or replace function get_or_create_student_financial_account(p_student_id uuid)
returns student_financial_accounts
language plpgsql security definer set search_path = public as $$
declare
  v_school_id uuid;
  v_account student_financial_accounts;
  v_reference text;
begin
  select id into v_account.id from student_financial_accounts where student_id = p_student_id;
  if v_account.id is not null then
    select * into v_account from student_financial_accounts where student_id = p_student_id;
    return v_account;
  end if;

  -- Read access alone (finance.read) is not enough to CREATE a new account — creating one is a
  -- write, gated the same way payments/enrollment already are. Guardians/self viewing a profile
  -- before an account exists simply see nothing yet, rather than silently minting one.
  if not (auth_has_permission('finance.write') or auth_has_permission('students.write')) then
    raise exception 'Not authorized to create a Student Financial Account.';
  end if;

  select school_id into v_school_id from students where id = p_student_id;
  if v_school_id is null then
    raise exception 'Student not found.';
  end if;

  v_reference := 'EDU' || lpad(nextval('student_payment_reference_seq')::text, 5, '0');

  insert into student_financial_accounts (school_id, student_id, payment_reference)
  values (v_school_id, p_student_id, v_reference)
  returning * into v_account;

  return v_account;
end;
$$;

revoke execute on function get_or_create_student_financial_account(uuid) from public, anon;
grant execute on function get_or_create_student_financial_account(uuid) to authenticated;
