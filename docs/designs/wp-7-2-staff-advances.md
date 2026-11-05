# WP 7.2: Staff loan / advance ledger feeding payroll (design, not built)

## What exists today
- `payroll_records` (monthly): has `other_deductions numeric` and `other_deductions_note`, statutory deductions computed by the payroll functions; approval via `approve_payroll_record` (edited by 4.2 for the two-person rule).
- Payroll is monthly. No loan or advance table exists (verify with a schema search before building).

## Proposed design
1. New tables (additive, RLS + policies in the same migration, tenant-isolation test): `staff_advances` (staff, principal amount, reason, instalment amount or count, start month, status: requested / approved / active / cleared / cancelled) and `staff_advance_instalments` (advance id, payroll month, amount due, amount deducted, payroll record id, status).
2. Approval: reuse the two-person helper from 4.2 (raised-by cannot approve when another approver exists).
3. Payroll feed WITHOUT changing existing payroll results: payroll today has one free `other_deductions` field. Options: (A) a new column `advance_deduction` on `payroll_records` (an ALTER of an existing table: STOP); (B) a separate view/function `advance_deduction_for(staff, month)` that finance applies by hand into `other_deductions` with a pre-filled note (no schema edit of payroll, but manual); (C) a new child table `payroll_record_deductions`, and payroll reads it only when a flag is on (edits the payroll calc: STOP). **Recommended: B in v1, C later after owner approval.**
4. Guards: instalment never takes net pay below an owner-set floor (default: not below 50% of net, verify with owner); advance cannot exceed N months of net pay; one active advance per staff member in v1; leaving staff: outstanding balance flagged in the exit checklist, never auto-deducted from final pay without approval.
5. Statutory note: advances are deducted from net pay after statutory items; they do not alter PAYE/NSSF/SHIF/AHL bases (verify with the school's accountant; some employers treat interest-free loans as taxable fringe benefits above a threshold, so v1 is interest-free and capped).
6. Flag `feature.payroll.advances`, off.

## STOP items
- Touches payroll: STOP. Option choice (A/B/C); floor percentage; tax treatment sign-off by an accountant.

## Dry-run path
Sandbox school, one synthetic advance over 3 months, confirm payroll results for the other staff are byte-identical before and after (a regression test that snapshots a payroll run).

## Rollback
Flag off; tables are append-only ledgers; option B changes nothing in payroll.

## Approval question
**Build the staff advance ledger with option B (manual, pre-filled deduction line)? (yes / no)**
