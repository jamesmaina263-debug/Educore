# WP 2.3: Bot "pay fees" over WhatsApp (design, not built)

## What exists today
- WP 1.3 Pay by Link (merged, dark, `feature.finance.pay_by_link`): `pay_links` and `pay_link_attempts`, `create_pay_link`, `revoke_pay_link`, service-role-only `pay_link_public_view`, `pay_link_begin_payment`, `pay_link_attempt_status`. Token stored as SHA-256 hash only, shown once; amount fixed by staff at creation; 48 h default life; rate limits per link, IP and phone (phone bucket shared with the staff STK push). The existing `mpesa-stk-push` / `mpesa-stk-callback` are untouched.
- The bot (guardian role only) answers fee balance, attendance, documents, absence notes, menu and Kiswahili, all read-only or request-style. It has carried 0 real conversations (flags on for Gititu only).
- Payment statuses in use: `confirmed`, `recorded`, `unallocated`, `reversed`, `pending`.

## Proposed design
1. New intent `pay_fees` (only when `feature.bot.pay_fees` AND `feature.finance.pay_by_link` are on for the school). Menu item added at the END of the list only if enabled (never renumber existing items).
2. Flow: guardian says "pay 5000" (or picks the menu item) -> bot resolves the child via the existing child-context rules -> bot reads the child's outstanding balance (same verified query as `fee_balance`) -> bot asks to confirm the amount ("Pay KES 5,000 for Ann by M-Pesa to 07xx...? Reply YES") -> a service-role function `bot_create_pay_link(school, guardian, student, amount)` creates a link for that guardian-learner pair and returns a one-time URL -> bot sends the URL.
3. The STK prompt itself happens on the public pay page, on the payer's own phone, through the unchanged STK flow. The bot never takes a PIN, never sees a PIN, never initiates a push itself in v1.
4. Amount rules: positive, whole shillings, not above the learner's outstanding balance plus an owner-set tolerance, minimum KES 10 (verify M-Pesa minimum). One open bot link per learner at a time.
5. Database: one additive migration: flag `feature.bot.pay_fees`, `bot_create_pay_link` (service_role only, re-checks guardian-learner link and flags), an audit log of bot-created links (who, learner, amount, no token). No existing table, function, policy, trigger or grant edited.

## STOP items (need the owner)
- It moves money (initiates a payment request) and messages parents: STOP applies.
- Enabling the flag for any school.
- Whether the payer must be the registered guardian number or may be any number (1.3 lets the payer type any number).
- Wording of the confirmation and of the "this is not a receipt" note.

## Dry-run / test-number path
1. Build dark. Test against the sandbox school only, with the Daraja sandbox shortcode.
2. Enable for ONE school on a test learner and a staff-held test phone; one real KES 10 payment end to end.
3. Reconcile that payment in the cashbook (6.1) to the shilling before any real parent uses it.

## Rollback
Flag `feature.bot.pay_fees` off (bot stops offering it; existing links expire in 48 h or are revoked with `revoke_pay_link`). Drop the new function and table if needed.

## Approval question
**Build the bot "pay fees" path on the 1.3 pay-link core, test-phone first? (yes / no)**
