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

## Suggested order

Given "both spotty connections and full dead zones happen regularly," the
highest-value next modules are the ones where someone is physically away
from a router doing time-sensitive data entry:

1. **Health / sick bay** (`checkInStudent`, `administerMedication`,
   `logEmergency`) -- typed-object actions, matches the checklist above
   directly, and a nurse mid-emergency is the clearest case for "must not
   lose this because wifi dropped."
2. **Boarding roll call** -- same shape as attendance, likely taken in
   dorms with the worst signal on campus.
3. **Library loans / inventory stock movements** -- typed-object, lower
   urgency but easy wins.
4. **Discipline** -- do last; needs the `FormData` adapter decision above
   settled first.

Each module should get its own review pass (this checklist, then a real
device/offline test) rather than being batch-applied -- that's what keeps
"don't break what's already working" true as this expands.
