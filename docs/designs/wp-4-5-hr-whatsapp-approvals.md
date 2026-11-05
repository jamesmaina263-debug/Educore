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
