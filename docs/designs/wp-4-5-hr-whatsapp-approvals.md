# WP 4.5: HR approvals over WhatsApp, leave first (design, not built)

The riskiest remaining WP: an approval is an authenticated business decision made from a chat app. Build it last.

## What exists today
- Leave requests and approval exist in the app (leave module; approvals by staff with the leave approval permission; a past bug class where RLS silently matched zero rows and approvals "succeeded" doing nothing is fixed, PRs #332-337: any new function must raise when it changes zero rows).
- WP 3.3 director WhatsApp registration: verified sender number = active staff `school_users` row whose profile phone equals the registered number, allowed role, flag on; re-verified on every message. Twilio retries are handled by a unique `MessageSid` index.
- Webhook: the 3.3 hook runs before the guardian lookup and returns `handled:false` on any miss.

## Proposed design (leave only)
1. Approver registers through the existing director registration (same consent screen) with an extra, separate consent for "approve leave by WhatsApp". Role must hold the existing leave-approval permission (re-checked at the moment of approval, not at registration).
2. The bot NEVER approves from a plain "yes". Flow: approver asks "pending leave" -> bot lists up to 5 pending requests with a short code each -> approver replies "approve K7F2" -> bot sends a **one-time confirmation code** (6 digits, 5 min, single use) to the SAME number -> approver replies with the code -> SQL function `leave_whatsapp_decide(request, decision, code)` (service_role only) re-verifies sender, permission, request status and that approver is not the requester, then records the decision exactly as the app does.
3. Every decision logs: approver, request, decision, MessageSid, code id (not the code), channel = whatsapp. A decision made on WhatsApp is visible in the app with a "via WhatsApp" marker.
4. No money moves: leave only. Payroll approval and anything financial are out of scope.
5. The function must raise if zero rows changed.
6. Additive migration: flag `feature.bot.hr_approvals`, tables for consent, one-time codes (hash only, expiry, attempts cap 3) and the decision log. No edit to existing leave tables or functions; the decision function calls the existing approval function if its signature allows a service-role caller, else it needs a thin new function (verify; if the existing function reads `auth.uid()` an edit would be needed, which is a STOP).

## STOP items
- Enabling for a live school; real messages to staff; if the existing approve function must be edited; the consent wording; whether a head can approve their own leave (recommended: never).

## Test-number path
Sandbox school, two staff-held test phones (requester and approver), full round trip including a wrong code, an expired code and a Twilio retry. Then Gititu, one approver, one request.

## Rollback
Flag off; codes expire in 5 minutes; decisions already recorded stay (same as an in-app decision).

## Approval question
**Approve the design for leave approvals over WhatsApp (leave only)? (yes / no)**

---

## Correction after the audit, and what shipped (5 Nov 2026)

**Read this section before the rest: where it disagrees with the text above, this section wins.**

Audited against the live database, not assumed:

1. **There is no approve function to reuse.** The app decides leave with a direct `UPDATE` of `leave_requests` under row-level security (policy needs `staff.leave.approve` in the same school). Nothing existing was edited.
2. **`auth_has_permission()` cannot be used from the bot** (it reads `auth.uid()`). `leave_wa_effective_permission()` reproduces its order (user override, school role override, default role grant, else false); a test checks parity with the real function.
3. **The database does not stop an approver changing their own leave** (the update policy has no requester check; only the app hides it). The new functions refuse it. **Open for the owner:** fixing the policy itself edits an existing RLS policy, not done.
4. **`notify_school_user()` depends on the caller's school** and does nothing for a service-role caller, so the decision function writes the same `notification_logs` row itself.
5. **Approvers today:** owner, principal, deputy principal by default grant, plus per-user overrides on `staff.leave.approve`. The WP 3.3 registry only admits those three roles, so v1 is those roles AND the effective permission at the moment of every step.
6. **Usage is tiny** (a handful of leave requests ever, none pending at audit time), so this is built dark and should be enabled for one school with a staff-owned approver number first.

Shipped, all flag-off (`feature.bot.hr_approvals`): PR #858 (database core: consent, one-time codes stored hashed, decision log, seven `leave_wa_*` functions, test `leave_whatsapp.sql`) and PR #859 (bot flow `LEAVE` / `APPROVE <ref>` / `REJECT <ref>` / six-digit code, hooked before the director hook; falls through on any error).

Rules enforced in the database: flag + director registration + separate consent + permission re-checked at every step; own leave and leave over 5 days refused; codes single use, 5 minutes, 3 wrong attempts burn them, 10 per hour; unique `MessageSid` makes a Twilio retry a no-op; the decision update must change exactly one row.

**Not built / still open:** the consent screen (the stored consent wording is a **draft** awaiting owner approval, so nobody can consent yet); a "decided via WhatsApp" marker in the app (the log table has it); Kiswahili text; fixing the self-approval gap at the policy level. Honest limit: the code goes to the same phone, so it stops accidents and forwarded messages, not someone holding the phone.
