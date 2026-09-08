# OS-04 — Last-synced-time evidence (GTM Readiness Protocol)

Date: 2026-09-05
DoD: Every offline-capable screen shows a clear last-synced timestamp.

## Before this session
Confirmed absent (matching the tracker's own repo-wide-search finding): no "last
synced" UI element anywhere in the codebase.

## What "last synced" means here, precisely
`syncPendingMutations()` now returns `reachedServer: boolean` in addition to
`synced`/`failed`. This is `true` when the pass either had nothing queued, or
attempted every queued item (even ones that failed for a real business reason,
e.g. a validation error -- that's still a genuine round trip). It's `false` only
when the pass aborted early on a raw network `TypeError` (the existing "connection
really isn't there" signal this function already used to stop early). Only a
`true` result advances the recorded last-synced time -- an all-network-failure
pass must not claim a fresh sync just because the function was called.

This distinction is deliberate and tested: a naive implementation that stamps
"now" every time `syncPendingMutations` is called (including on a real network
failure) would show a confidently wrong "Synced just now" to someone who is, in
fact, still offline.

## What was built
- `getLastSyncedAt(module)` / internal `setLastSyncedAt(module)` in `queue.ts`,
  persisted in IndexedDB (`cached_reads`, keyed `last_synced:<module>`) so it
  survives reloads -- not sensitive, so plain (unencrypted) storage.
- Wired into the shared `useOfflineSync()` hook (used by library, discipline,
  staff, exams x2, inventory, boarding x2, health x4, admissions x3 -- 14 call
  sites) and into `OfflineBanner`, which now always renders a
  "Synced 5 minutes ago" / "Not yet synced on this device" line, not just when
  offline or mid-sync.
- Attendance and the biometric kiosk have their own separate, pre-existing
  hooks/UI (not the shared component) -- wired identically:
  `use-attendance-sync.ts` reuses `getLastSyncedAt("attendance")` for free
  (its `syncPendingAttendance()` is already a thin wrapper around the shared
  `syncPendingMutations`); the kiosk gets its own inline line via the same
  exported `formatLastSynced()` helper, matching its existing custom layout
  rather than forcing in the shared banner component.
- Every one of the 15 offline-capable screens found in the codebase now shows
  this -- confirmed via a full repo-wide grep of every `useOfflineSync`/
  `useAttendanceSync` call site, not just the ones already known about.

## Testing
5 new tests in `queue.test.ts` covering: undefined before any sync; advances on
a reaching-the-server pass even with nothing queued; does **not** advance on a
real network drop; advances even when every item fails for a non-network
reason; and per-module independence. Updated the pre-existing sync-result
assertions across `queue.test.ts` and `biometric-kiosk-queue.test.ts` for the
new `reachedServer` field, including asserting `reachedServer: false` on both
existing network-drop tests.

Full suite: 174/174 passing project-wide (up from 174, net +5 new -0 broken --
the two network-failure tests already existed and now assert one more field).
`tsc --noEmit` and `eslint` both clean across all 20 touched files.

## Status
Ready for Review.
