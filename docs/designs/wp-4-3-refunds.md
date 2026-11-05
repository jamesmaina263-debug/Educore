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
