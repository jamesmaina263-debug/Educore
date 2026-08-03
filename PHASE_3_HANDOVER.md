# Phase 3 Handover Report

Covers all 4 Phase 3 items, built and shipped in build-order (Payroll → Library/Transport/Hostel → Inventory → Communication channel adapters), per the blueprint's own instruction to follow §8.4's ordering rather than improvise one. All 4 items are **GREEN LIGHT**: schema/RLS built, live-tested against real Supabase fixtures (created, exercised, cleaned up — zero leftover rows in every case), UI built, `tsc`/`eslint`/`next build` all clean, committed, pushed, and Vercel deploy confirmed `READY` for each.

## Commits

| Item | Commit | Deploy |
|---|---|---|
| 1. Payroll | `6909e39` | `dpl_3MFZNA7RLK7onPChG7FV5hLBEgdz` |
| 2. Library/Transport/Hostel | `e6fc09d` | `dpl_CiVsdTaQgYNdtrUvyMeMcFo4tSHN` |
| 3. Inventory | `a21d759` | `dpl_DGfMmbuHZw6qBhpPu9Mg9ffoxbvE` |
| 4. Communication (WhatsApp/Email) | `5fa9a1d` | `dpl_H8h3rynWgVxy96DRaXGSdUFKXzsb` |

---

## Item 1 — Payroll

**Schema:** `payroll_statutory_rates` (versioned Kenyan NSSF/SHIF/AHL/PAYE config, dated by `effective_from`, platform-wide not per-school — a rate change is a new row, never a code edit) and `payroll_records` (one payslip per staff member per calendar month, snapshotting the statutory rate in effect at generation time, same pattern as `invoices.total_amount`).

**Logic:** `generate_payroll_record()` / `approve_payroll_record()` / `mark_payroll_paid()` — draft → approved → paid. Bursar generates (`payroll.write`), cannot self-approve; only the owner has `payroll.approve` (principal is `payroll.read_any` only, matching the Finance "read-only day-to-day" pattern from Phase 2).

**Verified:** Math checked against a published Kenyan PAYE worked example (KES 50,000 gross → NSSF 3,000 / SHIF 1,375 / AHL 750 / taxable 44,875 / PAYE 5,845.85 / net 39,029.15 — exact match). Teacher denied write, bursar denied approve, owner approve works, paid records immutable, self-read via RLS confirmed.

**UI:** `/payroll` — generate dialog, payslip table with expandable NSSF/SHIF/AHL/PAYE breakdown, Approve/Mark paid actions.

**Caveat, stated plainly:** the seeded statutory rates are current as of this build (Feb-2026 NSSF Year 4 figures). Kenyan tax law has changed multiple times in the last two years (SHIF replacing NHIF Oct 2024, AHL relief status disputed across sources until resolved against the official KRA notice). Worth a sanity check from a Kenyan accountant before this touches real payroll.

---

## Item 2 — Library, Transport, Hostel

**Schema:** Built fresh against entity *names* the blueprint gave in §5/§7.6 — no columns were specified there, so the actual table design (7 tables total) is new work this item, not a transcription.
- `library_items`/`library_loans` — `issue_library_loan()`/`return_library_loan()` decrement/increment `available_copies`, block issuing at 0 copies.
- `transport_routes`/`transport_vehicles`/`student_transport_assignments` — `assign_transport()` auto-ends any prior active assignment (partial unique index enforces one active assignment per student).
- `hostel_rooms`/`hostel_allocations` — `allocate_hostel_room()` enforces room capacity, auto-ends prior active allocation.

**Roles:** Followed blueprint §8's matrix exactly — Owner/Principal full, Deputy read-only, Librarian/Transport Manager/Hostel Warden full-but-scoped-to-their-own-module, Bursar/Teacher/Class Teacher none, Parent/Student read-only via `auth_user_id_is_guardian_of()` / `students.school_user_id` self-link (reused Phase-1 plumbing, nothing new there).

**A real gotcha caught before shipping:** split every table's RLS into separate SELECT/INSERT/UPDATE policies from the start (not `for all`), specifically because the Payroll item's `payroll_statutory_rates` had shipped with a `multiple_permissive_policies` overlap that had to be fixed post-hoc. Advisor check after this item confirmed none of the 7 new tables appear in that warning.

**Verified:** librarian issues/returns a loan (copy count correct both directions, second issue at 0 copies blocked), teacher denied library write, transport manager assigns a route (parent reads child's assignment via guardian RLS), hostel capacity enforcement (1-capacity room correctly rejects a second student), librarian denied hostel write (cross-module boundary holds).

**UI:** `/library`, `/transport`, `/hostel`.

---

## Item 3 — Inventory

**Schema:** `inventory_categories`/`inventory_items`/`inventory_stock_movements` — general school asset/consumable tracking (desks, lab equipment, textbooks not in circulation), distinct from Library (loan-tracking against a catalogue) and Finance (money, not physical stock). `record_stock_movement()` handles in/out, blocks stock-out below available quantity, logs actor+reason per movement.

**A real gap in the blueprint, resolved and documented rather than silently guessed:** §8's roles matrix has no Inventory column at all. Judgment call, written directly into the migration comment: Owner/Principal full, Deputy read, Bursar full — reasoning: no dedicated "Inventory Manager" role exists among the 12, Bursar already writes Expenses (§7.4, the closest precedent), and a Kenyan school's bursar commonly doubles as stores/procurement officer in practice. No self-read case exists here (unlike loans/allocations, stock isn't tied to an individual student).

**Verified:** teacher denied item creation and stock movements; bursar creates an item, stocks in (0→20), stocks out (20→5), then a stock-out request for 10 against a 5-remaining item is correctly blocked with the exact shortfall in the error message.

**UI:** `/inventory` — items table with low-stock badges (compared against `reorder_level`), category management, stock-movement dialog, movement history.

---

## Item 4 — Communication: WhatsApp/Email channel adapters

**What existed already:** Phase 2's SMS build (`416fe8b`) was built channel-aware on paper — `communication_templates.channel` and `notification_logs.channel` both existed and defaulted to `'sms'` — but two things blocked actually adding a second channel: a `CHECK (channel = 'sms')` constraint on both tables (missed in the initial schema read this item; caught and fixed once email queueing hit it), and `notification_logs.recipient_phone` being `NOT NULL` (email has no phone).

**What changed:** widened both CHECK constraints to `sms`/`email`/`whatsapp`; added `recipient_email` + `subject` columns; relaxed `recipient_phone` to nullable with a new CHECK ensuring the right recipient field is populated per channel. `queue_communication()` gained `p_channel`/`p_subject` params and now skips recipients missing the relevant contact info per channel rather than failing the whole batch.

**A real risk caught mid-build:** the first version of the `queue_communication()` change used `CREATE OR REPLACE` with a different argument list than the original — Postgres treats that as a *new overload*, not a replacement, since function identity includes the parameter signature. That would have left two active `queue_communication` functions (3-arg and 5-arg) simultaneously, with real risk of Supabase's RPC layer resolving an ambiguous call incorrectly depending on how the client passed arguments. Caught via `pg_proc` inspection before it shipped; dropped the old 3-arg overload explicitly.

**Providers:** `_shared/email/` (Resend) and `_shared/whatsapp/` (Twilio), same factory + console-fallback pattern as the existing `_shared/sms/` (Africa's Talking) from Phase 0/2 — missing credentials degrade to a console-log stub rather than crashing. `send-communication` now dispatches by `row.channel` instead of always assuming SMS. Deployed, function version 2, `ACTIVE`.

**Verified:** SMS's original 3-arg call shape still works unchanged (backward compatibility deliberate, not incidental); email queueing correctly skips a phone-only recipient in a mixed batch and requires `recipient_email`; WhatsApp queues correctly. All three run under the pre-existing `communication.write` permission — no new permission key, since this is a channel addition to an existing capability, not a new module.

**UI:** `/communication` — channel selector in Compose (recipient list switches between guardian phone/email depending on channel), subject field appears only for email, channel selector+badge added to Templates, channel column added to History showing the correct recipient field per row.

---

## Outstanding from Phase 2, still not done

Both flagged in `PHASE_2_HANDOVER.md` §16, carried forward unchanged:
- Four secrets still unconfirmed in the deployed environment: `GEMINI_API_KEY`, `AT_USERNAME`/`AT_API_KEY`, `SUPABASE_SERVICE_ROLE_KEY`. Now also relevant to Item 4: `RESEND_API_KEY`/`RESEND_FROM_ADDRESS` and `TWILIO_ACCOUNT_SID`/`TWILIO_AUTH_TOKEN`/`TWILIO_WHATSAPP_FROM` are unset too — email/WhatsApp will silently use the console-log dev fallback until they're provided.
- No local migration files exist in the repo — three phases of schema now live only in Supabase, not in git. Flagged since Phase 1, still not addressed; Phase 3 added roughly a dozen new migrations on top of the existing debt.

## Phase-wide sanity check

Ran a full-project Supabase advisors pass (not scoped to any one item) after all 4 items shipped: every `multiple_permissive_policies` and `unindexed_foreign_keys` warning traces to Phase 0–2 tables. None of the 15 new tables or ~20 new functions introduced across Phase 3 appear in either list. The one class of warning every new SECURITY DEFINER function does trigger (`authenticated_security_definer_function_executable`) is intentional by design across this entire project — each function gates on an internal permission check — same as every RPC from Phase 0 onward.

## Phase 3 exit

No single cross-cutting "exit criterion" was defined for Phase 3 the way Phase 2 had one (Phase 3's own instruction was explicitly demand-driven, build-order-flexible). Read as: all 4 named items complete, tested, and deployed — which they are.
