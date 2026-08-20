alter table public.applications
  add column if not exists initial_payment_amount numeric,
  add column if not exists initial_payment_method text
    check (initial_payment_method is null or initial_payment_method in ('cash', 'mpesa', 'bank', 'cheque')),
  add column if not exists duplicate_check_acknowledged boolean not null default false;

comment on column public.applications.initial_payment_amount is 'Officer''s staged decision on the Finance step (Brief 4.16.9 step 9). The real payment/invoice is only recorded by Phase 13''s Complete Enrollment, using Finance''s own record_payment()/create_or_get_invoice_for_student() — this column is never read as a payment record on its own.';
comment on column public.applications.duplicate_check_acknowledged is 'Set true when the officer explicitly proceeds past a "possible existing student found" match at the Student step (Brief 4.16.9 step 2), rather than the match being silently ignored.';
