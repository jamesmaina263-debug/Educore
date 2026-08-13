# Scoping: Nurse → Parent Health Notification (Rectify list item 5)

Status: **design only — not yet built**. Written for review before implementation.

## The ask

> Add a button/feature allowing the nurse to notify parents about their child's health status.

## Current state

No such button exists anywhere in the Health module. It does not need new communication
infrastructure, though — the Communication module already has everything the message itself
needs to travel:

- `communication_templates` / `notification_logs` (SMS today; schema is already open to
  email/whatsapp as additional `channel` values without a new table).
- A generic, already-exported server action, `composeAndSendAction(...)` in
  `src/app/communication/actions.ts`, that queues a message via the `queue_communication` RPC
  and dispatches it through the `send-communication` Edge Function. It is not scoped to the
  Communication page — any module can import and call it directly.
- `student_guardians` already links a student to their guardian(s) with `primary_contact`,
  giving a phone/contact lookup with no new join needed.

This is a much smaller feature than the Nurse Inventory item — mostly wiring a new button to
existing plumbing, plus one small schema addition for categorization.

## Proposed design

### 1. Where the button lives

On the Sick Bay screen (`src/components/health/sick-bay-section.tsx`), the nurse's actual
day-to-day workflow screen — next to (or as a follow-up action after) checking a student in or
out of sick bay. This is the natural moment a nurse would want to notify a parent, rather than
a separate standalone "send a health message" screen disconnected from the visit record.

### 2. The composer

A small dialog, pre-filled with a default message built from the visit record already on
screen (student name, reason/symptoms if recorded, check-in time, and — once the visit has a
`check_out_at` — an outcome line), editable by the nurse before sending. Reuses the same
`Recipient`/`composeAndSendAction` shape the Communication module already uses:

```ts
composeAndSendAction({
  recipients: [{
    student_id: visit.student_id,
    recipient_type: "guardian",
    phone: guardian.phone, // from student_guardians, primary_contact first
    values: { student_name, reason, outcome },
  }],
  channel: "sms", // matches what's actually wired today; email/whatsapp once those channels are live
  body: editedMessage,
});
```

No new Edge Function, no new dispatch path — genuinely just a new call site for something that
already works.

### 3. One small schema addition

`communication_templates.category` and any place that reads it currently only allows
`fee_reminder | absence_alert | result_published | announcement | other`. Add a `health_alert`
value to that check constraint (a one-line, additive migration) so these messages are
distinguishable in Communication's own history/reporting from bulk announcements or fee
reminders, rather than all landing under the catch-all `other`.

### 4. Permission

Gate the button on `health.write` (the same permission that already governs recording a sick
bay visit) rather than inventing a new key — whoever can record a visit is exactly who should
be able to notify about it.

### 5. Audit trail

No extra work needed here: `notification_logs` already records every send attempt and its
outcome (queued/sent/failed/delivered) as part of the existing Communication infrastructure,
and Phase 17's system-wide audit logging already covers the underlying `sick_bay_visits` record
itself. The two together already answer "what happened and who was told."

## What this touches

One new button + dialog in `sick-bay-section.tsx`, one new (thin) wrapper action or a direct
call to the existing `composeAndSendAction`, and a one-line migration for the `health_alert`
category value. No new tables, no new Edge Function, no RLS changes beyond what already gates
`health.write`. This is a same-session-sized piece of work, not a multi-phase build.

## Open question for Lucy before building

Should this also cover a student with more than one guardian (send to all, or let the nurse
pick which one)? `student_guardians` supports multiple guardians per student with a
`primary_contact` flag — this design defaults to the primary contact only, but multi-recipient
is a small addition on top if you'd rather it go to everyone linked to the student.
