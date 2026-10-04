# Platform invoicing (EduCore → school)

How EduCore bills schools: numbering, calculation, the automated end-of-term run, the PDF, emailing,
payments and the audit trail. This extends the existing platform billing module
(`subscription_plans`, `school_subscriptions`, `platform_invoices`); it is unrelated to the
school-level fee invoices parents receive (`finance_invoices`).

Migration: `supabase/migrations/20261004090000_platform_invoicing.sql`
Tests: `supabase/tests/platform_invoicing.sql` (behavioural, rolls back), `src/lib/billing/*.test.ts`

## The model in one paragraph

**School → billing period → billable student count → rate → invoice.** The billing period is the
school's own **term** (`terms.start_date`–`end_date`). The student count is the number of students
whose `status` is in `platform_billing_settings.billable_student_statuses` (default `{active}`, the
rule the previous manual flow already used), counted **at the moment the invoice is created** and
recorded on the invoice. The rate is `school_subscriptions.price_override_kes` if set, otherwise
`subscription_plans.price_per_student_kes`, less any `recurring_discount_percent`, plus tax if
enabled. Everything is snapshotted onto the invoice, so later changes to rates, plans, school
profile or payment instructions never rewrite an invoice that was already issued.

## Where each thing is configured (nothing is hard-coded)

| What | Where |
|---|---|
| Price per student, per plan | Admin → Invoices → Billing settings → Rates (`subscription_plans`) |
| Custom price / recurring discount / billing email for one school | Invoice page → "School billing terms" |
| Invoice prefix, payment terms (days) | Billing settings → Numbering |
| Who counts as a billable student | Billing settings → Billable students |
| Tax (off by default) | Billing settings → Tax |
| M-Pesa Paybill/Till, bank details, other instructions, closing line | Billing settings → Payment instructions |
| Automation on/off, start date, look-back, auto-issue, auto-email | Billing settings → Automatic billing |
| Letterhead (logo, colours, contacts, legal name, address) | `src/lib/billing/company.ts` + `pdf-assets/` |

Payment instructions ship **empty**. Until you enter them, invoices say "payment details are
available from EduCore billing" rather than showing anything invented.

## Invoice numbers

`EDC-INV-2026-0001`: `prefix-year-sequence`, sequence per calendar year (Africa/Nairobi), allocated
from `platform_invoice_counters` by an upsert **inside the invoice-creating transaction**, so numbers
are unique and gap-free. A cancelled invoice keeps its number; numbers are never reused. A unique
index on `invoice_number` is the final backstop. The two invoices that existed before this change
were numbered `…-0001` / `…-0002` (in issue order) by the migration; their amounts, dates and
statuses were not changed.

## Lifecycle

`draft → issued → sent → (partially_paid) → paid`, plus `overdue` and `cancelled`.

* **Draft** – visible to platform staff only; never swept to overdue; PDF is watermarked DRAFT and
  shows the payment instructions configured *now*.
* **Issued** – visible to the school; due date = invoice date + payment terms (end of that day, EAT).
* **Sent** – emailed (or marked as delivered outside the system).
* **Overdue** – set daily by the existing cron for issued/sent/partially-paid invoices past due with a
  balance. **The existing policy is unchanged: a school with an overdue invoice is suspended 7 days
  later.** Drafts and zero-balance invoices are never swept.
* **Cancelled** – needs a reason; not possible while payments are recorded against it (void them first).

All transitions go through audited SQL functions; the table itself accepts no direct client writes.

## Automated billing run

Runs inside the **existing** daily cron `/api/cron/billing` (06:00 EAT, `vercel.json`), after the
trial-expiry / overdue / suspension steps. It calls `run_platform_billing_cycle()`, which uses the
read-only planner `plan_platform_billing_cycle()`. A school is invoiced for a term when **all** hold:

1. automation is switched on and a start date is set (`auto_generate_enabled`, `auto_effective_from`);
2. the school is `active` and has an `active` subscription (trial schools are never auto-billed);
3. the term's `end_date` has passed, is within the look-back window (default 45 days) and is on/after
   the start date. **Term `status` is deliberately ignored** – it is user-entered and unreliable
   (production has a term marked "closed" that ends in Dec 2027);
4. the plan's billing period is termly (monthly/annual are not automated yet);
5. the subscription did not start after the term ended;
6. no live invoice already covers or overlaps the period;
7. the school has at least one billable student.

Anything else is **skipped, with a reason**, never errored. Running it twice creates nothing new.
By default invoices are created as **drafts**; "issue automatically" and "email automatically" are
separate switches. A failure in this step is alerted (`sendSecurityAlert`) but never turns the
existing enforcement steps' result into a 500.

### Preview before you trust it

Admin → Invoices → Billing settings → **Preview run** shows exactly what would be created and why
others would be skipped (same code path as the cron; writes nothing). **Run now** performs the same run
on demand.

## Duplicate protection (database-level)

A unique `invoice_number`; a unique index on (school, period) and on (school, term) for non-cancelled
invoices; and a trigger that rejects any overlapping non-cancelled period for the same school, serialised
per school with an advisory lock. This closes the check-then-insert race behind the 2026-09-14
double-click duplicate. Verified with 12 truly concurrent sessions: 1 succeeds, 11 are rejected.

## PDF

`src/lib/billing/invoice-pdf.ts` (jsPDF, already a dependency) renders a real vector PDF: A4, selectable
text, embedded Inter / IBM Plex Mono subsets, the official logo, the letterhead header/footer
(`letterhead.ts`). It reads **only** the invoice row (snapshots), so a regenerated PDF matches the original.
`GET /api/billing/invoices/:id/pdf` runs as the signed-in user (RLS decides access; unknown, other-school
and draft ids are indistinguishable 404s) and audits a `downloaded` event; `?inline=1` views without
counting as a download. PDFs are rendered on demand; they are not stored as files.

### Regenerating PDF assets (fonts / logo)
`python3 scripts/generate-invoice-pdf-assets.py --fonts-dir <dir with the TTFs>` (see the script header).
Assets are embedded as base64 TypeScript so they are always bundled with the serverless function.

## Email

Edge function `send-platform-invoice` (verify_jwt=false; auth inside). Callers: an administrator's JWT
(Send / Resend button) or the cron using the existing shared `DISPATCH_SECRET` (`x-dispatch-secret`).
Recipient priority: admin override → `school_subscriptions.billing_email` → school owner → school email.
Subject: `EduCore Invoice [number] — [School]`, PDF attached. Safeguards: refuses to run without
`RESEND_API_KEY` + `RESEND_FROM_ADDRESS` (the shared provider would otherwise silently log instead of
sending); marks an invoice sent only after the provider accepts it; will not re-send an already-sent invoice
unless an admin explicitly resends; drafts/cancelled are never sent. Failures are recorded as a
`send_failed` event; unsent auto invoices are retried daily for 7 days when auto-email is on.

## Security

* `platform_invoices`: schools read only their own, **non-draft** invoices and only with `billing.read`
  (school owner, as before). Insert/update/delete policies were removed; writes only via SECURITY DEFINER
  functions that re-check `auth_is_super_admin()` / `service_role`, lock the row and validate the transition.
* A trigger rejects direct changes to financial columns, status and dates, and all deletes, even from
  service-role SQL; the audit table is append-only (trigger).
* Settings, payments, audit events and counters are readable only by platform staff (schools: nothing).
* Every new SECURITY DEFINER function revokes `public`/`anon` execute (and, for internal helpers,
  `authenticated`), as `AGENTS.md` and the anon-execute drift check require.

Note: `platform_invoices.notes` and `cancel_reason` are visible to the school that owns the invoice
(row-level security is per row, not per column). Treat them as customer-facing text.

## Operations

* **Mistaken payment** – Void it (reason required); balance and status are restored; history keeps both.
* **Wrong student count / rate on an issued invoice** – Reissue (cancels and issues a new, linked,
  recalculated invoice with a new number; only if nothing has been paid).
* **Goodwill** – Add discount (reason required; cannot drop the total below what is already paid).
* **Pause automation** – untick "Generate invoices automatically"; nothing else changes.
* **Suspension interplay** – cancelling an overdue invoice does *not* reactivate a suspended school;
  paying it in full does (only if no other invoice is overdue and the subscription is active).
