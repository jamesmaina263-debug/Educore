# Offline support rollout

## What changed in this pass

Attendance was the only module with offline support, and it was built as a
one-off (its own IndexedDB store, its own queue functions, its own sync
hook). This pass pulled that into a **generic engine** that any module can
plug into, and moved attendance onto it with no behavior change:

- `src/lib/offline/db.ts` -- IndexedDB wrapper. Two shared stores instead of
  one per module: `pending_mutations` (queued writes) and `cached_reads`
  (last-known-good data for the read side, not used yet -- see below).
  Migrates any already-queued v1 `pending_attendance` records into the new
  schema on first load, so upgrading the app can't silently drop a
  not-yet-synced offline submission.
- `src/lib/offline/queue.ts` -- `queueMutation()`, `getPendingMutations()`,
  `syncPendingMutations()`. Module-agnostic.
- `src/lib/offline/handlers.ts` -- the dispatch table. One line per queued
  mutation type, mapping it to the exact Server Action the online path
  already calls. This is the only file a new module needs to touch in the
  engine itself.
- `src/hooks/use-offline-sync.ts` -- `useOfflineSync(module)`: online status,
  pending count, failed items, syncing state, manual retry, discard. Auto-syncs
  on reconnect. For future modules to use directly.
- `src/lib/offline/attendance-queue.ts` is now a thin wrapper over the above
  (same exported function names/shapes, including `discardFailedSubmission`).
  `src/hooks/use-attendance-sync.ts` and `register-form.tsx` were **not**
  touched -- they already worked correctly against those same function names,
  so there was nothing to change there.
- `src/lib/offline/queue.test.ts` -- behavioral tests against a real (fake)
  IndexedDB: queue/sync happy path, error handling, per-module scoping, and
  the v1->v2 migration.

Verified: `tsc --noEmit`, `eslint`, and `vitest run` all pass. (Production
`next build` wasn't run here since it needs live Supabase env vars this
sandbox doesn't have -- run it once before deploying.)

## Two different action shapes in this codebase

Surveying every module's `actions.ts`:

- **Typed-object actions** (`submitAttendance(input: {...})`, most of
  health, exams, library, inventory's create/update actions) -- these queue
  into the engine above with no changes needed. This is the majority.
- **`FormData`-based actions** (`discipline/actions.ts` is entirely this
  shape; a couple of inventory actions too) -- these need a small adapter
  before they can be queued, because some of these forms may carry file
  attachments (e.g. a discipline report's evidence), and file survival
  through IndexedDB-then-replay isn't something to assume works without
  checking each form. Recommend converting these actions' inputs to a plain
  typed object (dropping file uploads, or handling them as a separate
  always-online step) on a case-by-case basis rather than queuing raw
  `FormData`.

## Per-module checklist (typed-object actions)

This is exactly what attendance already does -- copy the pattern:

1. **`src/lib/offline/handlers.ts`** -- import the action, add
   `"<module>:<actionName>": actionName as MutationHandler`.
2. **The client form component** -- mirror `register-form.tsx`:
   - `const { online, pendingCount, syncing, sync } = useOfflineSync("<module>");`
   - In the submit handler: if `!online`, call
     `queueMutation("<module>", "<actionName>", input)` instead of calling
     the action directly, and track queued-but-unconfirmed rows in local
     state (separate from confirmed data) so the UI can show them as
     "saved offline -- will sync".
   - Show the offline banner / pending-sync banner (copy the two `panel`
     blocks near the top of `register-form.tsx`).
   - When `online && pendingCount === 0` transitions after having queued
     something, `router.refresh()` so confirmed server data replaces the
     locally-queued rows.
3. **Read side** -- if the module's page needs to *render* while offline
   (not just accept writes), cache what it needs via `idbGet`/`idbPut` on
   `STORES.cachedReads` when the fetch succeeds online, and fall back to
   the cached copy when `!online`. Not built yet for any module beyond the
   store existing -- do this only for modules where working from stale data
   is actually useful (e.g. a nurse needs to see the student roster to check
   someone in, even if it's a few hours stale).
4. **Service worker (`public/sw.js`)** -- currently only caches the app
   shell. If a module's page itself needs to load while offline (not just
   its data), that page's route needs adding to the shell's cache list too.

## Progress

- [x] **Attendance** -- write queueing (`submitAttendance`), plus discard for
  permanently-failed items.
- [x] **Health** -- write queueing for `checkInStudent`, `checkOutStudent`,
  `administerMedication`, `logEmergency`, `createReferral`. All 4 write
  forms (sick bay, medication, emergencies, referrals) share one "health"
  module queue and one shared banner component
  (`src/components/health/offline-banner.tsx`), so a nurse sees one
  consistent "N entries waiting to sync" count regardless of which tab
  she's on.

  Deliberately **not** queued:
  - `updateReferralOutcome` -- an update to an existing record with no
    strong "must happen right now, in the field" need; a desk follow-up
    task once back online.
  - `sendHealthAlertAction` -- dispatches an actual guardian notification.
    Queuing a "the SMS is sent" action silently for later means the
    nurse's screen would say "sent" only once synced, with no way to tell
    the guardian in the moment that the message hasn't gone out yet. That
    needs its own delayed-delivery UX, not a silent replay -- left online-only
    for now.
  - Medical-inventory admin actions (`addMedicalInventoryItem`,
    `issueMedicalStock`, `acceptTransferAction`, `rejectTransferAction`) --
    desk-based bookkeeping, not field work under time pressure.

  **Known tradeoff, documented rather than silently accepted:**
  `administerMedication` can deduct from tracked medical inventory. If
  queued offline, that deduction only happens once the mutation actually
  syncs -- so the stock count shown during an outage won't reflect doses
  given but not yet synced. Two nurses (or one nurse across two offline
  sessions) could theoretically both believe there's enough stock for a
  dose that's already been used. Same category of risk as attendance's
  race on a duplicate submission (both are resolved by the server's real
  check running at sync time, not blindly trusted client-side) -- but
  worth knowing about specifically here since it's inventory, not just a
  record.

  Queued items intentionally do **not** appear in the sick-bay/medication/
  emergency/referral tables until they've actually synced -- there's no
  local row to show for something that only exists in this device's
  IndexedDB. The banner ("N entries waiting to sync") is what confirms the
  submission was captured in the meantime.

- [x] **Boarding** -- write queueing for `submitRollCall` and `logIncident`.
  Same shared-banner pattern as health, its own "boarding" module queue
  (`src/components/boarding/offline-banner.tsx`).

  `submitRollCall` also takes positional args (`date, session, entries`)
  rather than a single object -- same adapter pattern used for
  `checkOutStudent`, with its own dedicated args-ordering test.

  Deliberately **not** queued: house/dormitory/room/bed structure setup,
  `allocateStudentToBed` / `endAllocation` / `transferStudent`, and
  `updateIncidentStatus` -- all desk-based admin actions, not the
  dorm-floor, possibly-no-signal work roll call and incident logging are.

- [x] **Admissions (partial, by design)** -- write queueing for exactly 3 of
  the wizard's ~20 actions: `updateAdmissionDetails`, `updateApplicantIdentity`,
  `saveHealthProfileForApplication`. This module is structurally different
  from the three above, and the scope reflects that rather than forcing the
  same pattern where it doesn't fit:

  The admissions wizard is a **live, sequential, interdependent flow** --
  the code comment on `createOrLinkStudent` literally says "the Student
  record is created for real at step 2." Most of its actions genuinely
  need a fresh connection to be safe or meaningful:
  - `checkForDuplicateStudents` / `createOrLinkStudent` -- duplicate
    detection has to run against current server data; queuing a blind
    "create student" against possibly-stale duplicate-check results risks
    creating real duplicate student records.
  - `searchGuardians` / `linkGuardianToApplication` -- live search, no
    offline value without results to select from.
  - `uploadDocumentAsStaff` -- `FormData` with a file, same caveat as
    discipline (not queued anywhere in this rollout yet).
  - `allocateBoardingForApplication` / `assignTransportForApplication` --
    same desk-based-assignment reasoning as boarding's bed/transport
    actions, kept online-only for consistency.
  - `getFeePreview` / `saveFinanceDecision` / `getAdmissionChecklist` /
    `completeEnrollmentAction` -- the final commit step of the whole
    wizard, converting an application into a real enrolled student. This
    is the single highest-risk action in the app to run against stale
    offline state; it must run live, every time.

  What genuinely doesn't have that dependency -- three plain field saves
  (Admission Details, Applicant Identity, Health Profile step) -- are
  queued through the same engine as everything else, with their own
  banner (`src/components/admissions/offline-banner.tsx`) that says so
  explicitly: *"these steps are captured offline; the rest of the wizard
  needs a connection."* An admissions officer who loses signal mid-wizard
  doesn't lose typed-in data on those specific steps, but still can't
  finish enrolling a student until they're back online -- which was
  already true before this change, and isn't something a write-queue can
  safely fix.

  `updateAdmissionDetails` and `updateApplicantIdentity` both take
  `(applicationId, input)` -- two args, not one object -- same adapter
  pattern as `checkOutStudent` / `submitRollCall`, with its own test.

- [x] **Library** -- write queueing for `issueLoanAction`,
  `issueLoanToStaffAction`, `returnLoanAction`, `markLoanLostOrDamagedAction`.
  All 4 live in one component (`LibrarySection`) and share one "library"
  module queue/banner. `returnLoanAction(id)` takes a single positional
  string, not an object -- same adapter pattern as `checkOutStudent`, with
  its own test.

  Known tradeoff, same category as `administerMedication`'s: marking a
  loan "lost" also permanently deducts a copy from the collection, but
  only once the mutation actually syncs -- the copy count shown during an
  outage won't reflect it until then.

  Deliberately **not** queued: `createLibraryItemAction` /
  `adjustCopiesAction` (desk cataloguing), `createShelfAction` /
  `createReservationAction` / `createFineAction` (`FormData`),
  `cancelReservationAction` / `resolveFineAction` (desk follow-up).

- [x] **Inventory** -- write queueing for `recordStockMovementAction` only
  (the literal "stock movement" this rollout order named). Typed-object,
  RPC-backed, no adapter needed.

  Deliberately **not** queued: `createInventoryItemAction` /
  `createCategoryAction` (desk cataloguing), `createTransferAction`
  (desk-initiated, same reasoning as boarding's `transferStudent`), and
  everything asset/procurement-related (`FormData`, desk/office workflows).

## Next up

Given "both spotty connections and full dead zones happen regularly," the
remaining highest-value modules are the ones where someone is physically
away from a router doing time-sensitive data entry:

1. ~~Health / sick bay~~ -- done, see above.
2. ~~Boarding roll call~~ -- done, see above.
3. ~~Admissions~~ -- done (partial, by design), see above.
4. ~~Library loans / inventory stock movements~~ -- done, see above.
5. **Discipline** (next) -- needs the `FormData` adapter decision above
   settled first.

Each module should get its own review pass (this checklist, then a real
device/offline test) rather than being batch-applied -- that's what keeps
"don't break what's already working" true as this expands.
