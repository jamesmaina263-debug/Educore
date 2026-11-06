# WP 3.5: Same-day absence alert, WhatsApp channel and school switch (design, not built)

## What exists today
- A 3-consecutive-day absence SMS exists and stays unchanged. Attendance is in `student_attendance` (status present / late / absent; date per learner).
- Guardians are `school_users` (role parent) linked through `student_guardians`; phones are stored in mixed formats, so always compare on a normalised form. `uq_school_users_active_phone` forbids two active users with the same phone string.
- Business-initiated WhatsApp messages need Meta-approved templates (WP 0.4 lead time).

## Proposed design
1. New alert "absent today": after the school's attendance is marked (cut-off time per school, default 10:00 Nairobi), a learner marked absent with NO absence note from the guardian today triggers ONE message to that learner's primary-contact guardian.
2. Channel order per school setting: WhatsApp (if guardian opted in and a template is approved) else SMS (existing provider). One message per learner per day (dedupe key learner+date). Never re-sent if attendance is corrected to present (a "correction" message is NOT built in v1).
3. School switch: a per-school setting `same_day_absence_alerts` (off by default) plus per-guardian opt-out via a STOP keyword to the bot.
4. Dry-run log table (`would_send`, kind and key only, no child names in the log), cron route counting only, exactly the 3.1/3.2 pattern.
5. Additive migration only. The existing 3-day SMS function and its schedule are not edited.

## STOP items
- Messages real parents: STOP.
- Template wording (needs approval by Meta; Kiswahili needs native review).
- The cut-off time and whether late marking should suppress alerts.
- Cost: SMS/WhatsApp per message (owner's budget).

## Test-number path
Dry-run counts for two weeks -> send only to a staff-held test guardian -> one pilot class -> school.

## Rollback
Per-school switch off; nothing else depends on it.

## Approval question
**Build same-day absence alerts as an opt-in, test-number first? (yes / no)**
