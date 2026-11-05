# WP 3.4: Multi-campus group digest (design, not built)

## What exists today
- WP 3.3 director questions: registration in `director_whatsapp_numbers`, roles allowed = school owner, principal, deputy principal, one school at a time. `group_admin` (spans several schools via `school_group_id`) is deliberately excluded from that consent layer.
- WP 3.1 briefing (dark): recipients are registered directors in a school with BOTH `feature.bot.director` and `feature.bot.director_briefing` on; payload is per school.
- `school_users` has a trigger blocking changes to `role_id`, `school_id`, `school_group_id`, `status` unless the caller has `staff.manage`.

## Proposed design
1. Separate registration for group admins: table `group_digest_numbers` (group id, group-admin school_user id, phone, consent text, status), mirroring `director_whatsapp_numbers` but keyed to the GROUP, with its own consent wording that names every school covered.
2. One Saturday digest per group admin (not per school): a table row per school (collections this week vs last, Mon-Fri attendance %, outstanding), then a group total. Same figure basis as 3.1 (confirmed, recorded, unallocated payments; Africa/Nairobi dates; the unallocated note).
3. A school appears in a group digest only if that school itself has `feature.bot.director_briefing` on AND its principal/owner has not opted that school out (school-level consent beats group membership).
4. Dry-run first (`would_send` rows), same dedupe-key pattern as 3.1.
5. Additive migration only: flag `feature.bot.group_digest`, the table, register/revoke/status functions (authenticated), evaluate/mark (service_role).

## STOP items
- Sends messages to a director-level person: STOP (real sending); consent wording; per-school opt-out rule (decision 3); which group admins exist in production today (verify; may be none).

## Dry-run path
Dry-run cron route like `/api/cron/director-briefing`, counts only; then test number; then one real group.

## Rollback
Flag off; the table holds only consent and a log of kinds/keys, never figures.

## Approval question
**Build a separate group-level registration for `group_admin` digests? (yes / no)**
