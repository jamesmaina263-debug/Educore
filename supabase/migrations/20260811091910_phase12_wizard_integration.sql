-- Phase 12: Wizard Module Integration.
-- Almost all staging fields the wizard needs already exist on `applications` from Phase 10
-- (first_name..special_needs_info, guardian_id, academic_year_id, term_id, intended_class_id,
-- boarding_preference, transport_required) — Phase 10 built the application record to double as
-- the pre-enrollment staging area, so this migration only adds what's genuinely missing: the
-- Finance step's initial-payment decision (Brief 4.16.9 step 9 — "confirm initial billing, record
-- an initial payment if authorized, or skip payment"), and an explicit flag recording that the
-- officer reviewed a possible-duplicate match and chose to proceed anyway (Brief 4.16.9 step 2).
--
-- Design decision (was left open by Phase 11's comment "not a jsonb staging blob — left to Phase
-- 12 to decide how per-step data is held pre-enrollment"): per Phase 8's fee-resolution function
-- comment ("reused... including by the Admissions Step 9 charge preview once the onboarding
-- wizard is built" — resolve_fee_charges_for_student takes a real student_id), the Student step
-- creates/links a REAL `students` row immediately rather than deferring it to a final commit.
-- Every later step (Guardian, Academics, Boarding, Transport, Health, Finance) then writes
-- directly to its authoritative module using that real student_id, via existing
-- create/find-or-create functions — no shadow tables, no jsonb blob. Boarding/Transport
-- allocations are real rows from the moment they're made (their own unique-active-allocation
-- constraints already prevent double-booking). Phase 13's "Complete Enrollment" then becomes the
-- idempotent finalization step: validate the checklist, create/get the Finance invoice, record
-- history, generate the admission number's *enrollment* stamp, and flip status to enrolled —
-- safe to re-run if some pieces already exist from progressive wizard steps.

alter table public.applications
  add column if not exists initial_payment_amount numeric,
  add column if not exists initial_payment_method text
    check (initial_payment_method is null or initial_payment_method in ('cash', 'mpesa', 'bank', 'cheque')),
  add column if not exists duplicate_check_acknowledged boolean not null default false;

comment on column public.applications.initial_payment_amount is 'Officer''s staged decision on the Finance step (Brief 4.16.9 step 9). The real payment/invoice is only recorded by Phase 13''s Complete Enrollment, using Finance''s own record_payment()/create_or_get_invoice_for_student() — this column is never read as a payment record on its own.';
comment on column public.applications.duplicate_check_acknowledged is 'Set true when the officer explicitly proceeds past a "possible existing student found" match at the Student step (Brief 4.16.9 step 2), rather than the match being silently ignored.';
