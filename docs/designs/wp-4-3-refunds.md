# WP 4.3: Refund workflow (design, not built)

## What exists today
- WP 4.2 two-person rule (`feature.controls.two_person`, flag on for 0 schools): the person who raised an expense/payroll item may not approve it when another approver exists; a single-approver school keeps working and the self-approval is flagged in the audit log. Edited `approve_expense`, `raise_expense`, `approve_payroll_record` with the owner's approval.
- `payments` table with statuses `confirmed`, `recorded`, `unallocated`, `reversed`, `pending`. Reversal exists as a status; a refund (money going back out) does not exist.
- Cashbook (6.1, dark) reads payments read-only.

## Proposed design
1. Three steps, three records, all additive: **request** (`refund_requests`: payment id, student, amount, reason code, requested_by) -> **approve** (second person when another approver exists, same helper `two_person_other_approver_exists`; self-approval allowed and flagged only in a single-approver school) -> **pay-out record** (`refund_payouts`: method, reference, paid_by, paid_at) linked to the ORIGINAL payment id.
2. Rules enforced in SQL: refund <= original payment amount minus earlier refunds; only `confirmed`/`recorded` payments (not `pending`, `reversed`); one open request per payment; reasons from a fixed list plus free text; amounts in whole KES.
3. The system does NOT move money in v1. The pay-out record is a ledger entry made by a person after they pay by M-Pesa B2C / bank outside EduCore. (Automated B2C is a later, separate STOP.)
4. Accounting effect: a refund creates a negative-allocation line (credit note style) so `v_student_balances` and the cashbook reflect it. **Verify** how existing reversals adjust balances and reuse that mechanism rather than inventing one; this is the one place a design review of the existing ledger is required before building.
5. Audit: every step writes the audit log; the cashbook gets a "Refunds" line.
6. Flag `feature.finance.refunds`, off for everyone. New tables with RLS and policies in the same migration, plus a tenant-isolation test.

## STOP items
- Moves/records money out: STOP. Touches ledger balances: the reuse-vs-new decision in point 4 needs the owner.
- Permission name (a new `finance.refund` permission vs reuse of an existing one; verify roles table).
- Who may approve in a single-person school.

## Dry-run path
Build dark; sandbox school with synthetic payments; reconcile the cashbook to the shilling before and after a test refund.

## Rollback
Flag off. Refund rows are append-only records; nothing is deleted.

## Approval question
**Build the refund workflow (request, approve, pay-out record) dark? (yes / no)**

## Built (database core, 6 Nov 2026): what was decided and where it differs from the design above
Migration `20261106140000_wp_4_3_refunds_core.sql`, test `supabase/tests/refunds.sql`. Dark: `feature.finance.refunds` is off for everyone. No app screen yet (a separate PR after this migration is deployed, per AGENTS.md).

1. **Scope is narrower than point 2 above.** v1 refunds only money held as CREDIT: the part of a confirmed/recorded payment not applied to any invoice (overpayment, duplicate, paid in error). Refunding fees already applied to an invoice needs an invoice adjustment first and is NOT built. Reason codes: overpayment, duplicate_payment, paid_in_error, other (note required).
2. **Accounting (point 4): reuse the existing ledger, do not invent one.** A paid-out refund adds exactly one `payment_reversals` row and no allocation row. `v_student_balances` already subtracts reversals from net received and `cashbook_lines_internal` already lists them as money out, so balances and the cashbook update with no edit to either. `reverse_payment()` is deliberately NOT reused: it pulls amounts back off invoices first, which would re-open an invoice and leave the credit unchanged when the money refunded is credit.
3. **The ledger changes only at the pay-out record** (money really left), atomically with the pay-out row. Request and approval change no balance. The pay-out re-checks the ledger, so credit applied to a new invoice after approval makes the pay-out refuse.
4. **Permission (STOP item decided):** request, cancel and pay-out use the existing `finance.write` (bursar, owner). Approval uses a new key `finance.refund.approve`, granted by default to `school_owner` and `principal` only, so the maker and checker are different roles by default.
5. **Single-person schools (STOP item decided):** when another active user with `finance.refund.approve` exists, the requester cannot approve their own request. This is enforced ALWAYS, not only when `feature.controls.two_person` is on (money going out). When the requester is the only approver, self-approval is allowed and flagged `self_approved: true` in the audit log.
6. **Not done:** a separate "Refunds" cashbook line (reversals already appear as money out, labelled "Payment reversal"); automated B2C pay-out (still a separate STOP).
7. **Known quirk, not changed:** `v_student_balances` counts a `pending` payment as received, so `credit_balance` is overstated while an STK push is pending. The refund check does not rely on that alone: it also needs a confirmed/recorded payment with its own unapplied surplus.
