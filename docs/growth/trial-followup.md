# Growth Engine: trial follow-up (Phase 2 start)

A read-only admin page, `/admin/trials` ("Trial Follow-up" under Growth & Comms), that tells a person which trial
schools need a human check-in and why. **No migration, no new table, no messaging.** Suggestions only.

## What it shows

- **Needs a check-in**: running trials with at least one flag, most urgent first, with the owner's name and email, the
  reasons, and a suggested next step.
- **On track**: running trials with nothing flagged, and the next suggested check-in day.
- **Trial ended recently, not converted**: suspended schools whose trial ended in the last 14 days (the best moment for a
  personal win-back conversation).

## Flags (suggested defaults, all constants in `src/lib/growth/trial-followup.ts`)

| Flag | Rule |
|---|---|
| Ending soon | 3 days or fewer left (including a trial that has run out but not yet been expired by the daily job) |
| Inactive | From trial day 3: no sign-in/activity for 3+ days, or none recorded |
| No staff yet | From trial day 3: one staff account or fewer |
| Check-in due | Today is a suggested checkpoint day: 1, 3, 7, 14, 21, 27 or 30 (checkpoints longer than the trial are ignored) |

Urgency order is ending soon, then inactive, then no staff, then checkpoint; ties go to the school with fewer days left.
The suggested step follows the top flag. Wording never promises a discount, a free extension or an automatic message.

## Data and privacy

Reads only existing tables, as super admin: `school_subscriptions`, `schools`, `school_users` (owner contact and staff
count) and the `admin_school_last_active()` function the admin home page already uses. School-level facts only: no
learner data. Demo and QA schools and reserved test addresses are left out (the same rule the owner email campaigns use).
If a query fails, the page says so and shows nothing rather than guessing.

## How it is built

- `trial-followup.ts`: pure, time-injectable rules (unit-tested at the boundaries).
- `trial-followup-data.ts`: pure joining of the raw rows (owner choice, staff count, fallbacks), unit-tested.
- `components/admin/trial-followup.tsx`: presentational only.
- `app/(admin)/admin/trials/page.tsx`: auth gate, four queries, then the two functions above.

## Limits (deliberate)

- "Trial day" is elapsed 24-hour periods since the subscription row was created, not calendar days.
- Activity is the last sign-in or last-seen time of any user at the school. It cannot say what they did, and there is no
  per-day milestone history, so "setup progress" is limited to the staff-account count.
- Nothing is recorded about who followed up. That belongs in the existing sales pipeline if a trial becomes a lead.
- The page is not paginated; it lists running trials plus recent expiries, which are small sets.

## Not covered (later Phase 2 work)

Sending welcome or reminder messages (needs the WhatsApp/email provider decisions and consent rules), logging that a
check-in happened, and automated nudges. Each needs explicit approval first.
